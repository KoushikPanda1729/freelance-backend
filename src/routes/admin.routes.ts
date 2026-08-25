import { Router } from "express";
import { z } from "zod";
import { AddressLevel, NodeStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { requireAdmin } from "../middleware/auth";
import {
  adminSearchNodes,
  createMasterNode,
  findDuplicateCandidates,
  updateMasterNode,
} from "../services/addressNode.service";
import { mergeNodes } from "../services/merge.service";

const router = Router();
router.use(requireAdmin);

const levelEnum = z.enum(["COUNTRY", "STATE", "CITY", "PINCODE", "AREA", "SUBAREA"]);
const statusEnum = z.enum(["ACTIVE", "PENDING", "MERGED", "INACTIVE"]);

// GET /api/admin/nodes?level=&status=&parentId=&q=&page=&pageSize=
router.get("/nodes", async (req, res, next) => {
  try {
    const result = await adminSearchNodes({
      level: req.query.level ? (levelEnum.parse(req.query.level) as AddressLevel) : undefined,
      status: req.query.status ? (statusEnum.parse(req.query.status) as NodeStatus) : undefined,
      parentId: (req.query.parentId as string) || undefined,
      q: (req.query.q as string) || undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/nodes/:id
router.get("/nodes/:id", async (req, res, next) => {
  try {
    const node = await prisma.addressNode.findUnique({
      where: { id: req.params.id },
      include: {
        parent: true,
        children: true,
        aliases: true,
        mergedFrom: true,
        mergedInto: true,
      },
    });
    if (!node) return res.status(404).json({ error: "Not found" });
    res.json({ node });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/nodes/:id/duplicate-candidates
router.get("/nodes/:id/duplicate-candidates", async (req, res, next) => {
  try {
    const candidates = await findDuplicateCandidates(req.params.id);
    res.json({ candidates });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  level: levelEnum,
  name: z.string().min(1),
  parentId: z.string().nullish(),
  code: z.string().optional(),
  status: statusEnum.optional(),
});

router.post("/nodes", async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const node = await createMasterNode({
      level: body.level as AddressLevel,
      name: body.name,
      parentId: body.parentId ?? null,
      code: body.code,
      status: body.status as NodeStatus | undefined,
      performedBy: req.user?.email,
    });
    res.status(201).json({ node });
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  code: z.string().optional(),
  status: statusEnum.optional(),
});

router.put("/nodes/:id", async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    const node = await updateMasterNode(req.params.id, { ...body, performedBy: req.user?.email });
    res.json({ node });
  } catch (err) {
    next(err);
  }
});

const mergeSchema = z.object({
  primaryId: z.string().min(1),
  duplicateIds: z.array(z.string().min(1)).min(1),
});

router.post("/merge", async (req, res, next) => {
  try {
    const body = mergeSchema.parse(req.body);
    const result = await mergeNodes({ ...body, reason: "DUPLICATE", performedBy: req.user?.email });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const correctSchema = z.object({
  wrongId: z.string().min(1),
  correctId: z.string().min(1),
});

router.post("/correct", async (req, res, next) => {
  try {
    const body = correctSchema.parse(req.body);
    const result = await mergeNodes({
      primaryId: body.correctId,
      duplicateIds: [body.wrongId],
      reason: "CORRECTION",
      performedBy: req.user?.email,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/audit-log?nodeId=&page=&pageSize=
router.get("/audit-log", async (req, res, next) => {
  try {
    const page = req.query.page ? Number(req.query.page) : 1;
    const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 25;
    const where = req.query.nodeId
      ? { OR: [{ nodeId: req.query.nodeId as string }, { targetNodeId: req.query.nodeId as string }] }
      : {};
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { node: true, targetNode: true },
        orderBy: { performedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);
    res.json({ items, total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

export default router;
