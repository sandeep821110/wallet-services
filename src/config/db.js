import mongoose from "mongoose";

export const checkDBHealth = () => {
  const state = mongoose.connection.readyState;
  const stateMap = {
    0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting",
  };
  const status = stateMap[state] || "unknown";
  return {
    status: state === 1 ? "healthy" : "unhealthy",
    message: `MongoDB is ${status}`,
    state, connected: state === 1,
    host: mongoose.connection.host || null,
    db: mongoose.connection.name || null,
  };
};

export const connectDB = async () => {
  const conn = await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB Connected: ${conn.connection.host}`);
  return conn;
};
