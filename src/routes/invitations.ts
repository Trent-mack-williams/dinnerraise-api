import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { stripe } from "../lib/stripe";

export const invitationsRouter = Router();

// Guest details needed to confirm a seat from an invitation
const confirmSchema = z.object({
  guestName: z.string().trim().min(1, "Name is required"),
  dietaryRestrictions: z.array(z.string().trim()).default([]),
});

// POST /invitations/:token/confirm
// Public. The token in the URL proves the guest was invited
invitationsRouter.post("/:token/confirm", async (req, res) => {
  const parsed = confirmSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
  }

  try {
    // Transaction: the checks and the writes happen together, or not at all
    const seat = await prisma.$transaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { token: req.params.token },
        include: { event: { select: { id: true, capacity: true, title: true, seatPriceCents: true } } },
      });

      if (!invitation) throw new Error("INVALID_TOKEN");
      if (invitation.usedAt) throw new Error("ALREADY_USED");

      // Seats awaiting payment also hold a place, so count them too
      const taken = await tx.seat.count({
        where: { eventId: invitation.eventId, status: { in: ["CONFIRMED", "AWAITING_PAYMENT"] } },
      });
      if (taken >= invitation.event.capacity) throw new Error("EVENT_FULL");

      // Mark the invite as used so the link can't be reused
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { usedAt: new Date() },
      });

      const created = await tx.seat.create({
        data: {
          eventId: invitation.eventId,
          invitationId: invitation.id,
          guestEmail: invitation.guestEmail,
          guestName: parsed.data.guestName,
          dietaryRestrictions: parsed.data.dietaryRestrictions,
          status: "AWAITING_PAYMENT", // Held until Stripe confirms payment
        },
      });

      // Pass the price and title out so the checkout step can use them
      return {
        ...created,
        title: invitation.event.title,
        seatPriceCents: invitation.event.seatPriceCents,
      };
    });

    // Create the Stripe checkout right away, so the guest pays in one step
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: seat.guestEmail,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "gbp",
            unit_amount: seat.seatPriceCents,
            product_data: { name: `Seat: ${seat.title}` },
          },
        },
      ],
      metadata: { seatId: seat.id },
      success_url: "http://localhost:3000/payment/success",
      cancel_url: "http://localhost:3000/payment/cancelled",
    });

    await prisma.seat.update({
      where: { id: seat.id },
      data: { stripeSessionId: session.id },
    });

    return res.status(201).json({ seat, checkoutUrl: session.url });
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "INVALID_TOKEN") return res.status(404).json({ error: "This invitation link is not valid" });
    if (code === "ALREADY_USED") return res.status(409).json({ error: "This invitation has already been used" });
    if (code === "EVENT_FULL") return res.status(409).json({ error: "Sorry, this event is sold out" });
    console.error(err);
    return res.status(500).json({ error: "Something went wrong" });
  }
});