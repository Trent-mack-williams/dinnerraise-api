import Stripe from "stripe";
import { env } from "../config/env";

// One shared Stripe client. The secret key authenticates our requests to Stripe
export const stripe = new Stripe(env.STRIPE_SECRET_KEY);