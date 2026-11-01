import crypto from "crypto";
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

// GET /events
// Public. Lists upcoming events with seats still available
eventsRouter.get("/", async (_req, res) => {
  const events = await prisma.event.findMany({
    where: { startsAt: { gte: new Date() } }, // only events in the future
    orderBy: { startsAt: "asc" },            // soonest first
    include: {
      _count: {
        select: { seats: { where: { status: { in: ["CONFIRMED", "AWAITING_PAYMENT"] } } } },
      },
    },
  });

  // Work out seatsRemaining for each event and drop the raw count
  const result = events.map(({ _count, ...event }) => ({
    ...event,
    seatsRemaining: event.capacity - _count.seats,
  }));

  return res.status(200).json({ events: result });
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
      _count: { select: { seats: { where: { status: { in: ["CONFIRMED", "AWAITING_PAYMENT"] } } } } },
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

// Shared rules for a guest's details. Both open requests and invite confirmations use this
const bookSeatSchema = z.object({
  guestName: z.string().trim().min(1, "Name is required"),
  guestEmail: z.string().trim().toLowerCase().email("Please enter a valid email address"),
  dietaryRestrictions: z.array(z.string().trim()).default([]),
});

// Schema for an invitation: the guest's email address
const invitationSchema = z.object({
  guestEmail: z.string().trim().toLowerCase().email("Please enter a valid email address"),
});


// POST /events/:id/seats
// Public open request. Creates a PENDING seat; the host approves it later
eventsRouter.post("/:id/seats", async (req, res) => {
  const parsed = bookSeatSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const event = await prisma.event.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });

  if (!event) {
    return res.status(404).json({ error: "Event not found" });
  }
  
  // Block a second active request from the same email for the same event
    const existingSeat = await prisma.seat.findFirst({
    where: {
        eventId: event.id,
        guestEmail: parsed.data.guestEmail,
        status: { in: ["PENDING", "CONFIRMED"] },  // Ignore DECLINED and CANCELLED seats
    },
    });

    if (existingSeat) {
    return res.status(409).json({ error: "This email already has a request or seat for this event" });
    }

  // Pending requests don't use up capacity, so no count is needed here
  const seat = await prisma.seat.create({
    data: {
      eventId: event.id,
      guestName: parsed.data.guestName,
      guestEmail: parsed.data.guestEmail,
      dietaryRestrictions: parsed.data.dietaryRestrictions,
      status: "PENDING",
    },
  });

  return res.status(201).json({ seat });
});

// POST /events/:id/invitations
// Host-only. Only the event's own host may invite guests to it
eventsRouter.post("/:id/invitations", requireAuth, requireRole("HOST"), async (req, res) => {
  const parsed = invitationSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  const event = await prisma.event.findUnique({
    where: { id: req.params.id },
    select: { id: true, hostId: true },
  });

  if (!event) {
    return res.status(404).json({ error: "Event not found" });
  }

  // Ownership check: without this, any logged-in host could invite guests to anyone's dinner
  if (event.hostId !== req.user!.id) {
    return res.status(403).json({ error: "You can only invite guests to your own events" });
  }

  // 32 random bytes as a 64-character hex string. Impossible to guess
  const token = crypto.randomBytes(32).toString("hex");

  const invitation = await prisma.invitation.create({
    data: { eventId: event.id, guestEmail: parsed.data.guestEmail, token },
  });

  return res.status(201).json({
    invitation: {
      id: invitation.id,
      guestEmail: invitation.guestEmail,
      link: `http://localhost:3000/invite/${token}`,
    },
  });
});
