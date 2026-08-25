import { NextFunction, Request, Response } from "express";

export type Role = "admin" | "user";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { email: string; role: Role };
    }
  }
}

// Lightweight mock auth: the real platform's auth/session middleware plugs in here
// unchanged — this service only needs an email + role to attribute audit history.
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const role = (req.header("x-user-role") as Role) || "user";
  const email = req.header("x-user-email") || "guest@acrebytes.com";
  req.user = { email, role: role === "admin" ? "admin" : "user" };
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}
