import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { eventsRouter } from "./routes/events";

export function createApp() {
  const app = express();

  app.use(cors({ origin: "http://localhost:3000" }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Any request to /auth/... goes to authRouter.
  // So POST /auth/guest-email reaches the handler we wrote
  app.use("/auth", authRouter);

  app.use("/events", eventsRouter);

  return app;
}