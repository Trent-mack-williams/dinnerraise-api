import express from "express";
import cors from "cors";

// Builds and returns the Express app. It doesn't start listening yet
export function createApp() {
  const app = express();

  // Browsers block a page on localhost:3000 from calling localhost:4000 unless this API allows it
  app.use(cors({ origin: "http://localhost:3000" }));

  // Reads JSON request bodies into req.body so our code can use them
  app.use(express.json());

  // A simple route that confirms the server is alive
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}