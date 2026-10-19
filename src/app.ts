import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { eventsRouter } from "./routes/events";
import { invitationsRouter } from "./routes/invitations";
import { seatsRouter } from "./routes/seats";

export function createApp() {
  const app = express();

  app.use(cors({ origin: "http://localhost:3000" }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Any request to /auth/... goes to authRouter.
  app.use("/auth", authRouter);
  app.use("/events", eventsRouter);
  app.use("/invitations", invitationsRouter);
  app.use("/seats", seatsRouter);

  return app;
}