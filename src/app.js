import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import { checkDBHealth } from "./config/db.js";
import walletRoutes from "./routes/wallet.routes.js";

const app = express();

const defaultOrigins = "http://localhost:5173,http://localhost:5174,https://choosemood.com,https://www.choosemood.com";
const corsOrigins = (process.env.CORS_ORIGIN || defaultOrigins).split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin)) return callback(null, true);
    if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

app.use("/api/wallet", walletRoutes);

app.get("/health", async (req, res) => {
  const dbHealth = checkDBHealth();
  const allHealthy = dbHealth.status === "healthy";
  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? "healthy" : "degraded",
    service: "wallet-services",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: { mongodb: dbHealth },
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: "Internal server error" });
});

export default app;
