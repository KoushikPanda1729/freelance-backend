import { Router } from "express";
import { z } from "zod";
import { AddressLevel } from "@prisma/client";
import { getAncestorChain, listActiveNodes, resolveNode } from "../services/addressNode.service";

const router = Router();

const levelEnum = z.enum(["COUNTRY", "STATE", "CITY", "PINCODE", "AREA", "SUBAREA"]);

// GET /api/nodes?level=STATE&parentId=xxx&q=har
router.get("/", async (req, res, next) => {
  try {
    const level = levelEnum.parse(req.query.level);
    const parentId = (req.query.parentId as string) || undefined;
    const q = (req.query.q as string) || undefined;
    const nodes = await listActiveNodes({ level: level as AddressLevel, parentId, q });
    res.json({ items: nodes });
  } catch (err) {
    next(err);
  }
});

const resolveSchema = z.object({
  level: levelEnum,
  name: z.string().min(1),
  parentId: z.string().nullish(),
  confirmNodeId: z.string().optional(),
  ignoreSuggestions: z.boolean().optional(),
  code: z.string().optional(),
});

// POST /api/nodes/resolve
router.post("/resolve", async (req, res, next) => {
  try {
    const body = resolveSchema.parse(req.body);
    const result = await resolveNode({
      level: body.level as AddressLevel,
      name: body.name,
      parentId: body.parentId ?? null,
      confirmNodeId: body.confirmNodeId,
      ignoreSuggestions: body.ignoreSuggestions,
      code: body.code,
      createdBy: req.user?.email,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/nodes/:id/ancestors -> root-first chain, e.g. a Pincode returns [country, state, city]
// Powers "type a Pincode, auto-fill City/State/Country" in the shared address form.
router.get("/:id/ancestors", async (req, res, next) => {
  try {
    const ancestors = await getAncestorChain(req.params.id);
    res.json({ ancestors });
  } catch (err) {
    next(err);
  }
});

export default router;
