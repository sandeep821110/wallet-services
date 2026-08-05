import dotenv from "dotenv";
dotenv.config();
import app from "./src/app.js";
import { connectDB } from "./src/config/db.js";
import logger from "./src/utils/logger.js";

const PORT = process.env.PORT || 5016;

async function start() {
  try {
    await connectDB();
    app.listen(PORT, () => {
      logger.info(`Wallet Service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();
