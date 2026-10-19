import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { requireRole } from "../middleware/requireRole";

export const seatsRouter = Router();

const decisionSchema = z.object({
  status: z.enum(["CONFIRMED", "DECLINED"]),
});

// PATCH /seats/:seatId
// Host-only. Approves or declines a pending request
seatsRouter.patch("/:seatId", requireAuth, requireRole("HOST"), async (req, res) => {
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