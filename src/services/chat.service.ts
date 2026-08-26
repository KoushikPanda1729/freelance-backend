import { prisma } from "../prisma";

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

const SYSTEM_PROMPT = `You are the AB Assistant, a helpful chat assistant embedded in AcreBytes' internal real-estate platform. You can answer general questions, but you're especially useful for explaining how AB's Address Master & Mapping system works: the Country > State > City > Pincode > Area > Sub-area hierarchy, how matching/pending review/merge/correction work, and how the shared address component is used across the platform's pages.

When someone asks about counts, statistics, or "how many" of anything in the address master (pending items, active values, etc.), ALWAYS call the relevant tool to get the real live number - never guess, estimate, or give generic navigation instructions instead of an actual answer. Keep answers concise and use markdown formatting (headings, lists, bold, code) where it helps readability.`;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export class ChatNotConfiguredError extends Error {}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_pending_review_summary",
      description:
        "Get the CURRENT, real-time count of address values sitting in the Pending Review queue (submitted by users, awaiting an admin to approve or reject), broken down by hierarchy level.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_master_stats",
      description:
        "Get CURRENT, real-time Address Master statistics: how many values are Active, Pending, Merged, or Inactive at each hierarchy level (Country/State/City/Pincode/Area/Sub-area), plus the total number of saved user addresses across all entry pages.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
] as const;

async function getPendingReviewSummary() {
  const rows = await prisma.addressNode.groupBy({
    by: ["level"],
    where: { status: "PENDING" },
    _count: { _all: true },
  });
  const byLevel = Object.fromEntries(rows.map((r) => [r.level, r._count._all]));
  const total = rows.reduce((sum, r) => sum + r._count._all, 0);
  return { total_pending: total, pending_by_level: byLevel };
}

async function getMasterStats() {
  const rows = await prisma.addressNode.groupBy({
    by: ["level", "status"],
    _count: { _all: true },
  });
  const byLevel: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    byLevel[r.level] ??= {};
    byLevel[r.level][r.status] = r._count._all;
  }
  const totalUserAddresses = await prisma.userAddress.count();
  return { stats_by_level_and_status: byLevel, total_saved_addresses: totalUserAddresses };
}

async function executeTool(name: string): Promise<unknown> {
  switch (name) {
    case "get_pending_review_summary":
      return getPendingReviewSummary();
    case "get_master_stats":
      return getMasterStats();
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

async function callOpenAi(apiKey: string, messages: OpenAiMessage[]) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: 700,
      temperature: 0.3,
      messages,
      tools: TOOLS,
      tool_choice: "auto",
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as { choices?: { message?: OpenAiMessage }[] };
}

export async function getChatReply(history: ChatMessage[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ChatNotConfiguredError("OPENAI_API_KEY is not configured on the server.");

  const messages: OpenAiMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...history];

  // Up to 3 rounds: the model can call a tool, we execute it and feed the result back,
  // then it either answers or calls another tool (e.g. both stats tools in one turn).
  for (let round = 0; round < 3; round++) {
    const data = await callOpenAi(apiKey, messages);
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("Empty response from OpenAI.");

    if (msg.tool_calls?.length) {
      messages.push(msg);
      for (const call of msg.tool_calls) {
        const result = await executeTool(call.function.name);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
      continue;
    }

    const reply = msg.content?.trim();
    if (!reply) throw new Error("Empty response from OpenAI.");
    return reply;
  }

  throw new Error("Assistant took too many steps to answer - please rephrase your question.");
}
