import { AddressLevel, AddressNode, NodeStatus, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { normalizeKey, numberAwareSimilarity } from "../utils/normalize";
import { findAiDuplicateCandidates } from "./aiMatch.service";

const SUGGESTION_THRESHOLD = 0.72;
const MAX_SUGGESTIONS = 5;

export const LEVEL_ORDER: AddressLevel[] = ["COUNTRY", "STATE", "CITY", "PINCODE", "AREA", "SUBAREA"];

export function fkColumnForLevel(level: AddressLevel):
  | "countryId"
  | "stateId"
  | "cityId"
  | "pincodeId"
  | "areaId"
  | "subAreaId" {
  switch (level) {
    case "COUNTRY":
      return "countryId";
    case "STATE":
      return "stateId";
    case "CITY":
      return "cityId";
    case "PINCODE":
      return "pincodeId";
    case "AREA":
      return "areaId";
    case "SUBAREA":
      return "subAreaId";
  }
}

/** Follows the mergedInto chain so callers always land on the current live master. */
export async function resolveFinalNode(nodeId: string): Promise<AddressNode> {
  let node = await prisma.addressNode.findUniqueOrThrow({ where: { id: nodeId } });
  const seen = new Set<string>([node.id]);
  while (node.mergedIntoId) {
    if (seen.has(node.mergedIntoId)) break; // guard against corrupt cycles
    node = await prisma.addressNode.findUniqueOrThrow({ where: { id: node.mergedIntoId } });
    seen.add(node.id);
  }
  return node;
}

export async function listActiveNodes(params: {
  level: AddressLevel;
  parentId?: string | null;
  q?: string;
}) {
  const { level, parentId, q } = params;
  const where: Prisma.AddressNodeWhereInput = {
    level,
    status: "ACTIVE",
    parentId: level === "COUNTRY" ? null : parentId ?? undefined,
  };
  if (q) {
    const normalized = normalizeKey(q);
    where.normalizedKey = level === "PINCODE" ? { startsWith: normalized } : { contains: normalized };
  }
  return prisma.addressNode.findMany({ where, orderBy: { name: "asc" }, take: 100 });
}

export type ResolveResult =
  | { status: "linked"; node: AddressNode }
  | { status: "suggestions"; suggestions: (AddressNode & { score: number })[] }
  | { status: "created_pending"; node: AddressNode };

/**
 * Resolves user-entered text for one hierarchy level to a master node, scoped to its
 * parent (e.g. Area matching happens within the chosen City/Pincode only).
 * - exact normalized match (post abbreviation-expansion) -> auto-linked
 * - near match (e.g. "Sec 62" vs "Sector 62") -> returned as suggestions, never auto-merged
 * - no match -> created as PENDING for admin review
 */
export async function resolveNode(params: {
  level: AddressLevel;
  name: string;
  parentId?: string | null;
  createdBy?: string;
  confirmNodeId?: string;
  ignoreSuggestions?: boolean;
  code?: string;
}): Promise<ResolveResult> {
  const { level, name, parentId, createdBy, confirmNodeId, ignoreSuggestions, code } = params;
  const effectiveParentId = level === "COUNTRY" ? null : parentId ?? null;

  if (confirmNodeId) {
    const node = await resolveFinalNode(confirmNodeId);
    return { status: "linked", node };
  }

  const normalized = normalizeKey(name);

  // Alias table catches names that were merged/corrected away in the past.
  const aliasMatch = await prisma.addressAlias.findFirst({
    where: {
      normalizedKey: normalized,
      node: { level, parentId: effectiveParentId, status: "ACTIVE" },
    },
    include: { node: true },
  });
  if (aliasMatch) return { status: "linked", node: aliasMatch.node };

  const siblings = await prisma.addressNode.findMany({
    where: { level, parentId: effectiveParentId, status: "ACTIVE" },
  });

  const exact = siblings.find((s) => s.normalizedKey === normalized);
  if (exact) return { status: "linked", node: exact };

  if (!ignoreSuggestions) {
    const scored = siblings
      .map((node) => ({ node, score: numberAwareSimilarity(normalized, node.normalizedKey) }))
      .filter((s) => s.score >= SUGGESTION_THRESHOLD && s.score < 1)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SUGGESTIONS);

    if (scored.length > 0) {
      return {
        status: "suggestions",
        suggestions: scored.map((s) => ({ ...s.node, score: s.score })),
      };
    }
  }

  const created = await prisma.addressNode.create({
    data: {
      level,
      name: name.trim(),
      normalizedKey: normalized,
      code: code ?? null,
      parentId: effectiveParentId,
      status: "PENDING",
      isUserSubmitted: true,
      createdBy,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "CREATE",
      nodeId: created.id,
      performedBy: createdBy,
      meta: { level, name, parentId: effectiveParentId, source: "user-entry" },
    },
  });

  return { status: "created_pending", node: created };
}

/** Root-first ancestor chain for a node, e.g. a Pincode -> [country, state, city]. */
export async function getAncestorChain(nodeId: string): Promise<AddressNode[]> {
  const chain: AddressNode[] = [];
  let current = await prisma.addressNode.findUniqueOrThrow({ where: { id: nodeId } });
  while (current.parentId) {
    current = await prisma.addressNode.findUniqueOrThrow({ where: { id: current.parentId } });
    chain.unshift(current);
  }
  return chain;
}

export async function findDuplicateCandidates(nodeId: string) {
  const node = await prisma.addressNode.findUniqueOrThrow({ where: { id: nodeId } });
  const siblings = await prisma.addressNode.findMany({
    where: {
      level: node.level,
      parentId: node.parentId,
      status: "ACTIVE",
      id: { not: node.id },
    },
  });

  const textMatches = siblings
    .map((s) => ({ ...s, score: numberAwareSimilarity(node.normalizedKey, s.normalizedKey), aiSuggested: false }))
    .filter((s) => s.score >= SUGGESTION_THRESHOLD);

  // AI only looks at siblings text-matching already missed - no point spending a call
  // re-confirming what the cheap matcher already found.
  const alreadyCaught = new Set(textMatches.map((s) => s.id));
  const aiIds = await findAiDuplicateCandidates(
    node.name,
    node.level,
    siblings.filter((s) => !alreadyCaught.has(s.id)).map((s) => ({ id: s.id, name: s.name }))
  );
  const aiMatches = siblings.filter((s) => aiIds.includes(s.id)).map((s) => ({ ...s, score: 0, aiSuggested: true }));

  return [...textMatches, ...aiMatches].sort((a, b) => b.score - a.score);
}

export async function adminSearchNodes(params: {
  level?: AddressLevel;
  status?: NodeStatus;
  parentId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  const { level, status, parentId, q, page = 1, pageSize = 25 } = params;
  const where: Prisma.AddressNodeWhereInput = {};
  if (level) where.level = level;
  if (status) where.status = status;
  if (parentId) where.parentId = parentId;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { normalizedKey: { contains: normalizeKey(q) } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.addressNode.findMany({
      where,
      include: { parent: true, _count: { select: { mergedFrom: true, aliases: true } } },
      orderBy: [{ status: "asc" }, { level: "asc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.addressNode.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function createMasterNode(params: {
  level: AddressLevel;
  name: string;
  parentId?: string | null;
  code?: string;
  status?: NodeStatus;
  performedBy?: string;
}) {
  const { level, name, parentId, code, status = "ACTIVE", performedBy } = params;
  const node = await prisma.addressNode.create({
    data: {
      level,
      name: name.trim(),
      normalizedKey: normalizeKey(name),
      code: code ?? null,
      parentId: level === "COUNTRY" ? null : parentId ?? null,
      status,
    },
  });
  await prisma.auditLog.create({
    data: { action: "CREATE", nodeId: node.id, performedBy, meta: { name, level, source: "admin" } },
  });
  return node;
}

export async function updateMasterNode(
  id: string,
  params: { name?: string; code?: string; status?: NodeStatus; performedBy?: string }
) {
  const { name, code, status, performedBy } = params;
  const before = await prisma.addressNode.findUniqueOrThrow({ where: { id } });
  const node = await prisma.addressNode.update({
    where: { id },
    data: {
      ...(name ? { name: name.trim(), normalizedKey: normalizeKey(name) } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(status ? { status } : {}),
    },
  });

  let action: "UPDATE" | "ACTIVATE" | "DEACTIVATE" = "UPDATE";
  if (status && status !== before.status) {
    action = status === "ACTIVE" ? "ACTIVATE" : status === "INACTIVE" ? "DEACTIVATE" : "UPDATE";
  }

  await prisma.auditLog.create({
    data: {
      action,
      nodeId: node.id,
      performedBy,
      meta: { before: { name: before.name, status: before.status }, after: { name: node.name, status: node.status } },
    },
  });

  return node;
}
