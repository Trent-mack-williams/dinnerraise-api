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

// GET /events/mine
// Protected and host-only. Returns only the events this host created.
// Must sit above "/:id" so Express doesn't read "mine" as an id
eventsRouter.get("/mine", requireAuth, requireRole("HOST"), async (req, res) => {
  const events = await prisma.event.findMany({
    where: { hostId: req.user!.id },   // Filter to this host only
    orderBy: { startsAt: "asc" },      // Soonest event first
  });

  return res.status(200).json({ events });
});

// GET /events/:id
// Public. Anyone with the link can see the event's details.
// ":id" is a route parameter: the value in the URL is available as req.params.id
eventsRouter.get("/:id", async (req, res) => {
  const event = await prisma.event.findUnique({
    where: { id: req.params.id },
    // Only the fields a guest needs. Notice hostId is left out
    select: {
      id: true,
      title: true,
      cause: true,
      description: true,
      location: true,
      startsAt: true,
      seatPriceCents: true,
      capacity: true,
      // Count confirmed seats so the page can show "seats left"
      _count: { select: { seats: { where: { status: "CONFIRMED" } } } },
    },
  });

  if (!event) {
    return res.status(404).json({ error: "Event not found" });
  }

  // Calculate seats remaining. We never store this number; it's always derived
  const { _count, ...details } = event;
  return res.status(200).json({
    event: { ...details, seatsRemaining: event.capacity - _count.seats },
  });
});