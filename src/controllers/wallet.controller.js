import mongoose from "mongoose";
import WalletEntry from "../models/WalletEntry.model.js";
import logger from "../utils/logger.js";

const { ObjectId } = mongoose.Types;

const WALLET_PER_ORDER = 10;
const EXPIRY_DAYS = 6;

async function expireEntries(userId) {
  try {
    const result = await WalletEntry.updateMany(
      { userId, expired: false, expiresAt: { $lte: new Date() }, remainingAmount: { $gt: 0 } },
      { $set: { expired: true, remainingAmount: 0 } }
    );
    if (result.modifiedCount > 0) {
      logger.info(`Expired ${result.modifiedCount} wallet entries for user ${userId}`);
    }
  } catch (err) {
    logger.error("expireEntries error:", err);
  }
}

async function getBalance(userId) {
  const entries = await WalletEntry.find({ userId, expired: false, remainingAmount: { $gt: 0 } });
  return entries.reduce((sum, e) => sum + e.remainingAmount, 0);
}

export const getWalletBalance = async (req, res) => {
  try {
    const userId = req.user.id;
    await expireEntries(userId);
    const entries = await WalletEntry.find({ userId, expired: false, remainingAmount: { $gt: 0 } });
    const balance = entries.reduce((sum, e) => sum + e.remainingAmount, 0);
    const totalEarned = await WalletEntry.aggregate([
      { $match: { userId: new ObjectId(userId), source: { $ne: "redeem" } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const totalRedeemed = await WalletEntry.aggregate([
      { $match: { userId: new ObjectId(userId), source: "redeem" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    return res.json({
      success: true,
      data: {
        balance,
        totalEarned: totalEarned[0]?.total || 0,
        totalRedeemed: totalRedeemed[0]?.total || 0,
        entryCount: entries.length,
      },
    });
  } catch (err) {
    logger.error("getWalletBalance error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch wallet balance" });
  }
};

export const getWalletTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    await expireEntries(userId);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      WalletEntry.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WalletEntry.countDocuments({ userId }),
    ]);

    return res.json({
      success: true,
      data: { entries, total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error("getWalletTransactions error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch transactions" });
  }
};

export const creditWalletForOrder = async (userId, orderId) => {
  try {
    const amount = WALLET_PER_ORDER;
    const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const entry = await WalletEntry.create({
      userId,
      amount,
      remainingAmount: amount,
      source: "order",
      orderId,
      expiresAt,
    });
    logger.info(`Wallet credited: ₹${amount} for user ${userId} (order ${orderId})`);
    return entry;
  } catch (err) {
    logger.error(`creditWalletForOrder failed: user=${userId}, order=${orderId}`, err);
    return null;
  }
};

export const checkSpinAvailable = async (req, res) => {
  try {
    const userId = req.user.id;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const existing = await WalletEntry.findOne({
      userId,
      source: "spin_win",
      createdAt: { $gte: todayStart, $lte: todayEnd },
    });
    return res.json({ success: true, data: { canSpin: !existing } });
  } catch (err) {
    logger.error("checkSpinAvailable error:", err);
    return res.status(500).json({ success: false, message: "Failed to check spin availability" });
  }
};

export const creditWalletSpinWin = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount } = req.body;
    if (!amount || amount <= 0 || amount > 100) {
      return res.status(400).json({ success: false, message: "Invalid win amount" });
    }
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const existing = await WalletEntry.findOne({
      userId,
      source: "spin_win",
      createdAt: { $gte: todayStart, $lte: todayEnd },
    });
    if (existing) {
      return res.status(400).json({ success: false, message: "Already spun today. Come back tomorrow!" });
    }
    const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const entry = await WalletEntry.create({
      userId,
      amount,
      remainingAmount: amount,
      source: "spin_win",
      expiresAt,
    });
    const balance = await getBalance(userId);
    return res.json({ success: true, data: { entry, balance } });
  } catch (err) {
    logger.error("creditWalletSpinWin error:", err);
    return res.status(500).json({ success: false, message: "Failed to credit winnings" });
  }
};

export const redeemWallet = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, orderId } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid redeem amount" });
    }
    await expireEntries(userId);
    const entries = await WalletEntry.find({
      userId,
      expired: false,
      remainingAmount: { $gt: 0 },
    }).sort({ expiresAt: 1 });

    const available = entries.reduce((sum, e) => sum + e.remainingAmount, 0);
    if (amount > available) {
      return res.status(400).json({ success: false, message: `Insufficient balance. Available: ₹${available}` });
    }

    let remainingToDeduct = amount;
    const updatedEntries = [];
    for (const entry of entries) {
      if (remainingToDeduct <= 0) break;
      const deduct = Math.min(entry.remainingAmount, remainingToDeduct);
      entry.remainingAmount -= deduct;
      remainingToDeduct -= deduct;
      updatedEntries.push(entry.save());
    }
    await Promise.all(updatedEntries);

    await WalletEntry.create({
      userId,
      amount,
      remainingAmount: 0,
      source: "redeem",
      orderId,
      expiresAt: new Date(),
    });

    const newBalance = await getBalance(userId);
    return res.json({ success: true, data: { redeemed: amount, balance: newBalance } });
  } catch (err) {
    logger.error("redeemWallet error:", err);
    return res.status(500).json({ success: false, message: "Failed to redeem wallet" });
  }
};

export const creditOrderInternal = async (req, res) => {
  try {
    const { orderId } = req.body;
    const userId = req.user?.id;
    if (!orderId || !userId) {
      return res.status(400).json({ success: false, message: "orderId and authentication required" });
    }
    const entry = await creditWalletForOrder(userId, orderId);
    if (!entry) return res.status(500).json({ success: false, message: "Failed to credit wallet" });
    return res.json({ success: true, data: { entry } });
  } catch (err) {
    logger.error("creditOrderInternal error:", err);
    return res.status(500).json({ success: false, message: "Failed to credit wallet" });
  }
};
