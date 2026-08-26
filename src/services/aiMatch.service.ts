import { AddressLevel } from "@prisma/client";

// gpt-4o, not the mini variant: this only ever runs on an explicit admin click (never
// per-keystroke), so the extra cost is negligible - and mini was noticeably more prone
// to plausible-but-wrong extra matches (e.g. suggesting a merely-nearby landmark) on
// real sibling lists, which erodes trust in the suggestion faster than it's worth.
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";

/**
 * Supplementary duplicate signal on top of the text-similarity matcher: catches
 * same-place values that read as totally different strings (a landmark name vs the
 * official area name, a colloquial name vs the master spelling, etc.) - the exact
 * class of duplicate edit-distance can never find. Deliberately only called from the
 * explicit admin "Check duplicates" action (not the live per-keystroke resolve path),
 * so it never adds latency/cost to ordinary address entry. Fails open: any problem
 * (no key configured, network error, bad response) just yields no AI candidates -
 * the text-similarity results still work on their own.
 */
export async function findAiDuplicateCandidates(
  name: string,
  level: AddressLevel,
  siblings: { id: string; name: string }[]
): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || siblings.length === 0) return [];

  const list = siblings.map((s, i) => `${i + 1}. ${s.name}`).join("\n");
  const prompt = `You are standardising real-estate address data for India. Decide: does "${name}" refer to the EXACT SAME real-world location as any of these existing ${level.toLowerCase()} master values under the same parent location?
${list}

Only match if "${name}" and the existing value are two names for the literal same physical place - e.g. a full name vs its abbreviation ("Mahatma Gandhi Road" = "MG Road"), or a landmark that IS commonly used as the name of that exact spot (a metro station that IS the market it sits in, e.g. "Rajiv Chowk" = "Connaught Place").

Do NOT match for any of these reasons, even if they seem related:
- They are merely near, adjacent to, or in the same neighbourhood as each other (e.g. a metro station near a sector is NOT that sector).
- One is a broader area (a city, sector, or phase) that the other is merely located within.
- A city or town name is NEVER a match for a specific locality inside it - "Gurgaon"/"Gurugram" itself can never match any of its own sub-areas.
- The names just look or sound similar without you being confident they denote the identical place.

If in doubt, do not match. Reply with ONLY the matching numbers, comma-separated (e.g. "2,5"). Reply "NONE" if none match. No explanation.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 30,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text || /none/i.test(text)) return [];

    const indices = text.match(/\d+/g)?.map(Number) ?? [];
    return indices.map((i) => siblings[i - 1]?.id).filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}
