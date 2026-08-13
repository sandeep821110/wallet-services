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
  const conn = await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  console.log(`MongoDB Connected: ${conn.connection.host}`);

  try {
    const col = conn.connection.collection("wallet_entries");

    // Clean up duplicates left over from unlimited-spin testing:
    // keep only the earliest spin_win entry per user per day.
    const dupes = await col.aggregate([
      { $match: { source: "spin_win", spinDate: { $ne: null } } },
      { $sort: { createdAt: 1 } },
      { $group: { _id: { userId: "$userId", spinDate: "$spinDate" }, ids: { $push: "$_id" } } },
      { $match: { $expr: { $gt: [{ $size: "$ids" }, 1] } } },
    ]).toArray();

    let removed = 0;
    for (const d of dupes) {
      const [, ...rest] = d.ids;
      removed += (await col.deleteMany({ _id: { $in: rest } })).deletedCount;
    }
    if (removed > 0) console.log(`Removed ${removed} duplicate daily spin entries`);

    // Enforce exactly one spin per user per day.
    // Partial index (not sparse) so non-spin entries with spinDate: null are ignored.
    await col.dropIndex("userId_1_spinDate_1").catch(() => {});
    await col.createIndex(
      { userId: 1, spinDate: 1 },
      { unique: true, partialFilterExpression: { spinDate: { $type: "string" } } }
    );
    // Balance lookup + 7-day auto purge (TTL).
    await col.createIndex({ userId: 1, expired: 1, expiresAt: 1 });
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    console.log("Wallet indexes ready (one spin/day + 7-day purge)");
  } catch (err) {
    console.warn("Wallet index setup skipped:", err.message);
  }

  return conn;
};
