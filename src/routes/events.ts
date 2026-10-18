import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";

export const eventsRouter = Router();

// Validation rules for a new event. Anything not listed here is ignored
const createEventSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  cause: z.string().trim().optional(),
  description: z.string().trim().optional(),
  location: z.string().trim().min(1, "Location is required"),
  // z.coerce.date converts the ISO string from the frontend into a Date object
  startsAt: z.coerce.date().refine((d) => d > new Date(), {
    message: "Event must start in the future",
  }),
  // Whole cents only. £19.99 must be sent as 1999
  seatPriceCents: z.number().int().min(0, "Price cannot be negative"),
  // At least one seat, and whole numbers only
  capacity: z.number().int().min(1, "Capacity must be at least 1"),
});

// POST /events
// Order matters: requireAuth checks the token, then requireRole checks the role
eventsRouter.post("/", requireAuth, requireRole("HOST"), async (req, res) => {
  const parsed = createEventSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    });
  }

  // The host id comes from the verified token, never from the request body
  const event = await prisma.event.create({
    data: {
      ...parsed.data,
      hostId: req.user!.id,
    },
  });

  return res.status(201).json({ event });
});