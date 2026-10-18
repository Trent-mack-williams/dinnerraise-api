// Request and Response types from Express, plus NextFunction for passing control onward
import type { Request, Response, NextFunction } from "express";
// jwt verifies tokens and throws an error if the signature or expiry is wrong
import jwt from "jsonwebtoken";
// env gives us the secret used to sign tokens
import { env } from "../config/env";

// The shape of the data we store inside a token. It must match what login signs
interface TokenPayload {
  sub: string;   // The user's id
  role: "HOST" | "GUEST";
}

// Extend Express's Request type so later code knows req.user exists.
// This is a TypeScript-only declaration; it doesn't change runtime behaviour
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: "HOST" | "GUEST" };
    }
  }
}

// Middleware: runs before a protected route handler.
// Calling next() lets the request continue. Sending a response stops it here
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Read the Authorization header, which should look like "Bearer eyJhbG..."
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  // Everything after "Bearer " is the token itself
  const token = header.slice("Bearer ".length);

  try {
    // Checks the signature and expiry. Throws if either is wrong
    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;

    // Make the user's details available to the route handler
    req.user = { id: payload.sub, role: payload.role };

    // Hand control to the next function in the chain
    return next();
  } catch {
    // Expired, tampered with, or signed with a different secret
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}