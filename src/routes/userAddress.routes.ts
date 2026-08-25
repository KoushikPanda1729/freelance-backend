import { Router } from "express";
import { z } from "zod";
import {
  createUserAddress,
  getUserAddressForEntity,
  updateUserAddress,
} from "../services/userAddress.service";

const router = Router();

const baseSchema = {
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  countryId: z.string().min(1),
  stateId: z.string().min(1),
  cityId: z.string().min(1),
  pincodeId: z.string().min(1),
  areaId: z.string().min(1),
  subAreaId: z.string().nullish(),
  line1: z.string().optional(),
  line2: z.string().optional(),
  landmark: z.string().optional(),
  rawAreaText: z.string().optional(),
  rawSubAreaText: z.string().optional(),
};

const createSchema = z.object(baseSchema);
const updateSchema = z.object(baseSchema).partial();

// GET /api/user-addresses?entityType=PROPERTY_LISTING&entityId=123
router.get("/", async (req, res, next) => {
  try {
    const entityType = req.query.entityType as string;
    const entityId = req.query.entityId as string;
    if (!entityType || !entityId) {
      return res.status(400).json({ error: "entityType and entityId are required" });
    }
    const address = await getUserAddressForEntity(entityType, entityId);
    res.json({ address });
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const address = await createUserAddress({ ...body, createdBy: req.user?.email });
    res.status(201).json({ address });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const body = updateSchema.parse(req.body);
    const address = await updateUserAddress(req.params.id, body);
    res.json({ address });
  } catch (err) {
    next(err);
  }
});

export default router;
