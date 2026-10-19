import { Router, raw } from "express";
import { prisma } from "../lib/prisma";
import { stripe } from "../lib/stripe";
import { env } from "../config/env";

export const webhooksRouter = Router();

// POST /webhooks/stripe
// raw() keeps the body as bytes, which the signature check requires
webhooksRouter.post("/stripe", raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["stripe-signature"];

  if (!signature || typeof signature !== "string") {
    return res.status(400).send("Missing signature");
  }

  // Verify the message really came from Stripe. Throws if the signature is wrong
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send("Invalid signature");
  }

  // checkout.session.completed fires when a guest finishes paying
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const seatId = session.metadata?.seatId;

    if (seatId) {
      // updateMany only matches seats still awaiting payment.
      // If Stripe retries this event, the second run matches nothing and changes nothing
      await prisma.seat.updateMany({
        where: { id: seatId, status: "AWAITING_PAYMENT" },
        data: { status: "CONFIRMED" },
      });
    }
  }

  // Always acknowledge receipt, or Stripe will keep retrying
  return res.status(200).json({ received: true });
});