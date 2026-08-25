import { prisma } from "../prisma";
import { fkColumnForLevel } from "./addressNode.service";
import { buildFullAddressCache } from "./userAddress.service";

/**
 * Reparents any children of `fromId` onto `toId`. If a child with the same
 * normalized name already exists under `toId`, that child is merged too
 * (recursively) instead of creating a duplicate sibling.
 */
async function reparentOrMergeChildren(fromId: string, toId: string, performedBy?: string) {
  const children = await prisma.addressNode.findMany({ where: { parentId: fromId, status: "ACTIVE" } });
  for (const child of children) {
    const existingUnderTarget = await prisma.addressNode.findFirst({
      where: { parentId: toId, level: child.level, normalizedKey: child.normalizedKey, status: "ACTIVE" },
    });
    if (existingUnderTarget) {
      await mergeNodes({
        primaryId: existingUnderTarget.id,
        duplicateIds: [child.id],
        reason: "DUPLICATE",
        performedBy,
      });
    } else {
      await prisma.addressNode.update({ where: { id: child.id }, data: { parentId: toId } });
    }
  }
}

async function relinkUserAddresses(fromId: string, toId: string, level: string) {
  const column = fkColumnForLevel(level as any);
  const result = await prisma.userAddress.updateMany({
    where: { [column]: fromId } as any,
    data: { [column]: toId } as any,
  });

  const affected = await prisma.userAddress.findMany({
    where: { [column]: toId } as any,
    include: { country: true, state: true, city: true, pincode: true, area: true, subArea: true },
  });
  for (const ua of affected) {
    const cache = buildFullAddressCache(ua as any);
    if (cache !== ua.fullAddressCache) {
      await prisma.userAddress.update({ where: { id: ua.id }, data: { fullAddressCache: cache } });
    }
  }

  return result.count;
}

export async function mergeNodes(params: {
  primaryId: string;
  duplicateIds: string[];
  reason: "DUPLICATE" | "CORRECTION";
  performedBy?: string;
}) {
  const { primaryId, duplicateIds, reason, performedBy } = params;
  const primary = await prisma.addressNode.findUniqueOrThrow({ where: { id: primaryId } });

  const results: { duplicateId: string; relinkedCount: number }[] = [];

  for (const duplicateId of duplicateIds.filter((id) => id !== primaryId)) {
    const duplicate = await prisma.addressNode.findUniqueOrThrow({ where: { id: duplicateId } });
    if (duplicate.level !== primary.level) {
      throw new Error(`Cannot merge a ${duplicate.level} node into a ${primary.level} node`);
    }
    if (duplicate.status === "MERGED") continue; // already handled (e.g. by recursive child merge)

    await reparentOrMergeChildren(duplicateId, primaryId, performedBy);

    const relinkedCount = await relinkUserAddresses(duplicateId, primaryId, duplicate.level);

    await prisma.addressNode.update({
      where: { id: duplicateId },
      data: { status: "MERGED", mergedIntoId: primaryId },
    });

    await prisma.addressAlias.create({
      data: {
        nodeId: primaryId,
        aliasText: duplicate.name,
        normalizedKey: duplicate.normalizedKey,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: reason === "CORRECTION" ? "CORRECT" : "MERGE",
        nodeId: duplicateId,
        targetNodeId: primaryId,
        relinkedCount,
        reason,
        performedBy,
        meta: { duplicateName: duplicate.name, primaryName: primary.name, level: primary.level },
      },
    });

    results.push({ duplicateId, relinkedCount });
  }

  const totalRelinked = results.reduce((sum, r) => sum + r.relinkedCount, 0);
  const finalPrimary = await prisma.addressNode.findUniqueOrThrow({ where: { id: primaryId } });
  return { primary: finalPrimary, results, totalRelinked };
}
