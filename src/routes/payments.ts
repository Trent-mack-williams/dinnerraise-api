import { Router } from "express";
import { prisma } from "../lib/prisma";
import { stripe } from "../lib/stripe";

export const paymentsRouter = Router();

// POST /payments/checkout/:seatId
// Public: the guest has no account. The seat id is the reference
paymentsRouter.post("/checkout/:seatId", async (req, res) => {
  const seat = await prisma.seat.findUnique({
    where: { id: req.params.seatId },
    include: { event: { select: { title: true, seatPriceCents: true } } },
  });

  if (!seat) {
    return res.status(404).json({ error: "Seat not found" });
  }

  // Only a host-approved seat can pay. Pending requests can't skip approval
  if (seat.status !== "AWAITING_PAYMENT") {
    return res.status(409).json({ error: "This seat is not ready for payment" });
  }

  // Create a hosted Checkout page for exactly this seat
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: seat.guestEmail,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: seat.event.seatPriceCents,
          product_data: { name: `Seat: ${seat.event.title}` },
        },
      },
    ],
    // Stripe puts this id in the webhook, so we know which seat was paid for
    metadata: { seatId: seat.id },
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutes from now, in Unix seconds then then session expeire and the seat is no longer reserved
    success_url: "http://localhost:3000/payment/success",
    cancel_url: "http://localhost:3000/payment/cancelled",
  });

  // Save the session id so the webhook and any retries can find this seat
  await prisma.seat.update({
    where: { id: seat.id },
    data: { stripeSessionId: session.id },
  });

  return res.status(200).json({ url: session.url });
});