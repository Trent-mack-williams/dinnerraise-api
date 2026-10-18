// Express gives us the Router, which groups related routes together
import { Router } from "express";
// Zod checks the shape of incoming data
import { z } from "zod";
// Our shared database connection
import { prisma } from "../lib/prisma";
// bcrypt hashes passwords so the originals are never stored
import bcrypt from "bcrypt";
// jwt creates and verifies signed login tokens
import jwt from "jsonwebtoken";
// env gives us the JWT_SECRET from .env
import { env } from "../config/env";

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

// POST /auth/host-email
// Creates a host account. The password is set in the next step, via /auth/host-password
authRouter.post("/host-email", async (req, res) => {
  // Reuse the same email validation rules as guests
  const parsed = guestEmailSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    });
  }

  const { email } = parsed.data;

  // Look for an existing account with this email
  const existing = await prisma.user.findUnique({ where: { email } });

  // An existing guest can't become a host just by entering their email.
  // We reject it to keep roles clear; in practice this is handled in a later step
  if (existing && existing.role !== "HOST") {
    return res.status(409).json({
      error: "This email is already registered as a guest",
    });
  }

  // If a host account already exists, return it. Otherwise create one with no password yet
  const user =
    existing ??
    (await prisma.user.create({
      data: { email, role: "HOST" },
    }));

  return res.status(200).json({
    user: { id: user.id, email: user.email, role: user.role },
  });
});
// Schema for the password step: at least 8 characters, matching the design
const passwordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// POST /auth/host-password
// Sets a password on an existing host account
authRouter.post("/host-password", async (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    });
  }

  const { email, password } = parsed.data;

  // The host must already exist from the host-email step
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.role !== "HOST") {
    return res.status(404).json({ error: "Host account not found" });
  }

  // Turn the password into a hash. The "10" is the cost factor: higher is slower, and harder for attackers
  const passwordHash = await bcrypt.hash(password, 10);

  // Save only the hash
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  return res.status(200).json({ message: "Password set" });
});

// Schema for login: an email and a password
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, "Password is required"),
});

// POST /auth/login
// Checks the email and password, then returns a signed token
authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    });
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });

  // Use the same generic message for "no such user" and "wrong password".
  // This stops attackers learning which emails have accounts
  const invalid = { error: "Invalid email or password" };

  if (!user || !user.passwordHash) {
    return res.status(401).json(invalid);
  }

  // bcrypt.compare hashes the typed password the same way and compares the results
  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    return res.status(401).json(invalid);
  }

  // Create a token containing the user's id and role, valid for 7 days
  const token = jwt.sign(
    { sub: user.id, role: user.role },
    env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  return res.status(200).json({
    token,
    user: { id: user.id, email: user.email, role: user.role },
  });
});