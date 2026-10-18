//A middleware that only lets through users with the role you specify
import type { Request, Response, NextFunction } from "express";

// Returns a middleware that only allows users with one of the given roles.
// Usage: requireRole("HOST") runs after requireAuth, so req.user already exists
export function requireRole(...allowedRoles: Array<"HOST" | "GUEST">) {
  return (req: Request, res: Response, next: NextFunction) => {
    // req.user is set by requireAuth. If it's missing, the route was wired up wrongly
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    // 403 means "you're logged in, but not allowed to do this"
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission for this action" });
    }

    return next();
  };
}