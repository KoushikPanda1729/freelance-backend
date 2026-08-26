import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { attachUser } from "./middleware/auth";
import nodesRoutes from "./routes/nodes.routes";
import userAddressRoutes from "./routes/userAddress.routes";
import adminRoutes from "./routes/admin.routes";
import searchRoutes from "./routes/search.routes";
import chatRoutes from "./routes/chat.routes";

export const app = express();

app.use(cors());
app.use(express.json());
app.use(attachUser);

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "ab-address-service" }));

app.use("/api/nodes", nodesRoutes);
app.use("/api/user-addresses", userAddressRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/chat", chatRoutes);

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", details: err.flatten() });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "A master value with this name already exists at this level" });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Record not found" });
    }
  }
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});
