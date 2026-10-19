// Loads the .env file into process.env. Must run before anything reads environment variables
import "dotenv/config";
// Zod describes the shape of data and checks it at runtime
import { z } from "zod";

// Describes what valid environment variables look like
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),        // Must be a non-empty string
  JWT_SECRET: z.string().min(32),         // Must be at least 32 characters
  PORT: z.coerce.number().default(4000),  // .env values are text; coerce turns "4000" into the number 4000
  STRIPE_SECRET_KEY: z.string().startsWith("sk_test_", "Use a test key (sk_test_...) while developing"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_", "Webhook secret must start with whsec_"),
});

// Checks process.env against the schema and throws if anything is wrong.
// The result is typed, so env.PORT is known to be a number everywhere it's used
export const env = envSchema.parse(process.env);