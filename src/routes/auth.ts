// Express gives us the Router, which groups related routes together
import { Router } from "express";
// Zod checks the shape of incoming data
import { z } from "zod";
// Our shared database connection
import { prisma } from "../lib/prisma";

// A Router is a mini-app for a group of related URLs. We'll mount it under /auth
export const authRouter = Router();

// Describes what the request body must look like.
// If the frontend sends anything else, we reject it before touching the database
const guestEmailSchema = z.object({
  email: z
    .string()
    .trim()                    // Remove accidental spaces around the address
    .toLowerCase()             // "Sam@Gmail.com" and "sam@gmail.com" are the same person
    .email("Please enter a valid email address"),
});

// POST /auth/guest-email
// "async" because database calls take time and we wait for them with "await"
authRouter.post("/guest-email", async (req, res) => {
  // safeParse checks the data without throwing an error, so we can respond nicely
  const parsed = guestEmailSchema.safeParse(req.body);

  // If validation failed, send a 400 (Bad Request) with the reason
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    });
  }

  // The validated, cleaned-up email
  const { email } = parsed.data;

  // Look for an existing user with this email
  let user = await prisma.user.findUnique({ where: { email } });

  // If none exists, create a new guest account. No password is needed for guests
  if (!user) {
    user = await prisma.user.create({
      data: { email, role: "GUEST" },
    });
  }

  // Return only what the frontend needs. Never send back the passwordHash
  return res.status(200).json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  });
});