import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./lib/prisma";

// Build the app
const app = createApp();

// Start listening on the port from .env. The callback runs once the server is ready
const server = app.listen(env.PORT, () => {
  console.log(`API running on http://localhost:${env.PORT}`);
});

// Close the server and database connection before exiting, so nothing is left hanging
async function shutdown() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

// SIGINT is Ctrl+C. SIGTERM is what hosting platforms send when stopping your app
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);