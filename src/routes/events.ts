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

// Schema: the host chooses CONFIRMED or DECLINED
const decisionSchema = z.object({
  status: z.enum(["CONFIRMED", "DECLINED"]),
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

// POST /events/invitations/:token/confirm
// Public, but the token proves the guest was invited
eventsRouter.post("/invitations/:token/confirm", async (req, res) => {
  const parsed = bookSeatSchema.pick({ guestName: true, dietaryRestrictions: true }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  try {
    // Transaction: the checks and the writes happen together, or not at all
    const seat = await prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { token: req.params.token },
        include: { event: { select: { id: true, capacity: true } } },
      });

      if (!invitation) throw new Error("INVALID_TOKEN");
      if (invitation.usedAt) throw new Error("ALREADY_USED");

      const confirmed = await tx.seat.count({
        where: { eventId: invitation.eventId, status: "CONFIRMED" },
      });
      if (confirmed >= invitation.event.capacity) throw new Error("EVENT_FULL");

      // Mark the invite as used so the link can't be reused
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { usedAt: new Date() },
      });

      return tx.seat.create({
        data: {
          eventId: invitation.eventId,
          invitationId: invitation.id,
          guestEmail: invitation.guestEmail,
          guestName: parsed.data.guestName,
          dietaryRestrictions: parsed.data.dietaryRestrictions,
          status: "CONFIRMED",
        },
      });
    });

    return res.status(201).json({ seat });
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "INVALID_TOKEN") return res.status(404).json({ error: "This invitation link is not valid" });
    if (code === "ALREADY_USED") return res.status(409).json({ error: "This invitation has already been used" });
    if (code === "EVENT_FULL") return res.status(409).json({ error: "Sorry, this event is sold out" });
    console.error(err);
    return res.status(500).json({ error: "Something went wrong" });
  }
});

// PATCH /events/seats/:seatId
// Host-only. Approves or declines a pending request
eventsRouter.patch("/seats/:seatId", requireAuth, requireRole("HOST"), async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Status must be CONFIRMED or DECLINED" });
  }

  try {
    const seat = await prisma.$transaction(async (tx) => {
      const existing = await tx.seat.findUnique({
        where: { id: req.params.seatId },
        include: { event: { select: { hostId: true, capacity: true } } },
      });

      if (!existing) throw new Error("SEAT_NOT_FOUND");
      // Only the host of this event can decide on its seats
      if (existing.event.hostId !== req.user!.id) throw new Error("FORBIDDEN");
      if (existing.status !== "PENDING") throw new Error("NOT_PENDING");

      // Capacity is only checked when approving. Declining frees nothing
      if (parsed.data.status === "CONFIRMED") {
        const confirmed = await tx.seat.count({
          where: { eventId: existing.eventId, status: "CONFIRMED" },
        });
        if (confirmed >= existing.event.capacity) throw new Error("EVENT_FULL");
      }

      return tx.seat.update({
        where: { id: existing.id },
        data: { status: parsed.data.status },
      });
    });

    return res.status(200).json({ seat });
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "SEAT_NOT_FOUND") return res.status(404).json({ error: "Seat not found" });
    if (code === "FORBIDDEN") return res.status(403).json({ error: "You can only manage seats for your own events" });
    if (code === "NOT_PENDING") return res.status(409).json({ error: "This request has already been decided" });
    if (code === "EVENT_FULL") return res.status(409).json({ error: "Sorry, this event is sold out" });
    console.error(err);
    return res.status(500).json({ error: "Something went wrong" });
  }
});