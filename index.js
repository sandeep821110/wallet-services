import dotenv from "dotenv";
dotenv.config();
import app from "./src/app.js";
import { connectDB } from "./src/config/db.js";
import logger from "./src/utils/logger.js";

const PORT = process.env.PORT || 5016;

const requiredEnvVars = ["MONGO_URI"];
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  logger.error(`Missing required environment variables: ${missingEnvVars.join(", ")}`);
  process.exit(1);
}

let server;

async function start() {
  try {
    await connectDB();
    server = app.listen(PORT, () => {
      logger.info(`Wallet Service running on port ${PORT}`);
    });

    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("unhandledRejection", (reason) => {
      logger.error("Unhandled promise rejection:", reason?.message || reason);
      process.exit(1);
    });
    process.on("uncaughtException", (err) => {
      logger.error("Uncaught exception:", err.message);
      process.exit(1);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);
  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    const mongoose = (await import("mongoose")).default;
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    logger.info("All connections closed successfully");
    process.exit(0);
  } catch (err) {
    logger.error("Error during graceful shutdown:", err.message);
    process.exit(1);
  }
};

start();
