import mongoose from "mongoose";
import WalletEntry from "../models/WalletEntry.model.js";
import logger from "../utils/logger.js";

const { ObjectId } = mongoose.Types;

const WALLET_PER_ORDER = 10;
const EXPIRY_DAYS = 7;

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

export const getWalletActiveEntries = async (req, res) => {
  try {
    const userId = req.user.id;
    await expireEntries(userId);
    const entries = await WalletEntry.find({
      userId,
      expired: false,
      remainingAmount: { $gt: 0 },
      amount: { $gt: 0 },
    })
      .sort({ createdAt: 1 })
      .lean();
    return res.json({ success: true, data: { entries } });
  } catch (err) {
    logger.error("getWalletActiveEntries error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch wallet entries" });
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

const todaySpinDate = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

export const checkSpinAvailable = async (req, res) => {
  try {
    const userId = req.user.id;
    const existing = await WalletEntry.findOne({
      userId,
      source: "spin_win",
      spinDate: todaySpinDate(),
    });
    return res.json({ success: true, data: { canSpin: !existing } });
  } catch (err) {
    logger.error("checkSpinAvailable error:", err);
    return res.status(500).json({ success: false, message: "Failed to check spin availability" });
  }
};

const SPIN_CASH_PRIZES = [5, 7, 9, 10];
const FREE_DELIVERY_EXPIRY_DAYS = 30;
const SPIN_OUTCOMES = [
  ...SPIN_CASH_PRIZES.map((amount) => ({ type: "cash", amount })),
  { type: "free_delivery" },
  { type: "none" },
];

const pickSpinOutcome = () => SPIN_OUTCOMES[Math.floor(Math.random() * SPIN_OUTCOMES.length)];

export const creditWalletSpinWin = async (req, res) => {
  try {
    const userId = req.user.id;
    const spinDate = todaySpinDate();
    const existing = await WalletEntry.findOne({
      userId,
      source: "spin_win",
      spinDate,
    });
    if (existing) {
      return res.status(400).json({ success: false, message: "Already spun today. Come back tomorrow!" });
    }

    const outcome = pickSpinOutcome();
    const isCash = outcome.type === "cash";
    const amount = isCash ? outcome.amount : 0;
    const expiresAt = new Date(
      Date.now() +
        (outcome.type === "free_delivery" ? FREE_DELIVERY_EXPIRY_DAYS : EXPIRY_DAYS) * 24 * 60 * 60 * 1000
    );
    let entry;
    try {
      entry = await WalletEntry.create({
        userId,
        amount,
        remainingAmount: amount,
        source: "spin_win",
        spinDate,
        prizeType: outcome.type,
        expiresAt,
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(400).json({ success: false, message: "Already spun today. Come back tomorrow!" });
      }
      throw err;
    }
    const balance = await getBalance(userId);
    return res.json({ success: true, data: { entry, balance, prize: outcome } });
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
    for (const entry of entries) {
      if (remainingToDeduct <= 0) break;
      const deduct = Math.min(entry.remainingAmount, remainingToDeduct);
      const updated = await WalletEntry.findOneAndUpdate(
        { _id: entry._id, remainingAmount: { $gte: deduct } },
        { $inc: { remainingAmount: -deduct } },
        { new: true }
      );
      if (!updated) continue;
      remainingToDeduct -= deduct;
    }

    if (remainingToDeduct > 0) {
      return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

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

export const getBalanceInternal = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!ObjectId.isValid(String(userId))) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }
    await expireEntries(userId);
    const balance = await getBalance(userId);
    return res.json({ success: true, data: { userId, balance } });
  } catch (err) {
    logger.error("getBalanceInternal error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch wallet balance" });
  }
};

export const creditOrderInternal = async (req, res) => {
  try {
    const { orderId, userId } = req.body;
    if (!orderId || !userId) {
      return res.status(400).json({ success: false, message: "orderId and userId are required" });
    }
    if (!ObjectId.isValid(String(userId)) || !ObjectId.isValid(String(orderId))) {
      return res.status(400).json({ success: false, message: "Invalid userId or orderId" });
    }
    const existing = await WalletEntry.findOne({
      userId,
      source: "order",
      orderId,
    });
    if (existing) {
      return res.json({ success: true, alreadyCredited: true, data: { entry: existing } });
    }
    const entry = await creditWalletForOrder(userId, orderId);
    if (!entry) return res.status(500).json({ success: false, message: "Failed to credit wallet" });
    return res.json({ success: true, data: { entry } });
  } catch (err) {
    logger.error("creditOrderInternal error:", err);
    return res.status(500).json({ success: false, message: "Failed to credit wallet" });
  }
};

export const getFreeDeliveryStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const active = await WalletEntry.findOne({
      userId,
      source: "spin_win",
      prizeType: "free_delivery",
      used: false,
      expired: false,
      expiresAt: { $gt: new Date() },
    });
    return res.json({ success: true, data: { available: !!active, entry: active || null } });
  } catch (err) {
    logger.error("getFreeDeliveryStatus error:", err);
    return res.status(500).json({ success: false, message: "Failed to check free delivery" });
  }
};

export const consumeFreeDeliveryInternal = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId || !ObjectId.isValid(String(userId))) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }
    const now = new Date();
    const updated = await WalletEntry.findOneAndUpdate(
      {
        userId,
        source: "spin_win",
        prizeType: "free_delivery",
        used: false,
        expired: false,
        expiresAt: { $gt: now },
      },
      { $set: { used: true } },
      { new: true }
    );
    if (!updated) {
      return res.status(400).json({ success: false, message: "No active free delivery coupon" });
    }
    return res.json({ success: true, data: { consumed: true, entry: updated } });
  } catch (err) {
    logger.error("consumeFreeDeliveryInternal error:", err);
    return res.status(500).json({ success: false, message: "Failed to consume free delivery coupon" });
  }
};
