import type { Request } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma";
import { env } from "../config/env";

// Returns the logged-in user if a valid token is sent, otherwise null. Never throws
export async function getOptionalViewer(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;

  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as { sub: string };
    return await prisma.user.findUnique({ where: { id: payload.sub } });
  } catch {
    return null;
  }
}