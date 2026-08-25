import { Router } from "express";
import { searchUserAddresses } from "../services/userAddress.service";

const router = Router();

// GET /api/search?q=sector+62&entityType=PROPERTY_LISTING
router.get("/", async (req, res, next) => {
  try {
    const result = await searchUserAddresses({
      q: (req.query.q as string) || undefined,
      entityType: (req.query.entityType as string) || undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
