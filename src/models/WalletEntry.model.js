import mongoose from "mongoose";

const WalletEntrySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  remainingAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  source: {
    type: String,
    enum: ["order", "spin_win", "admin", "redeem"],
    required: true,
  },
  prizeType: {
    type: String,
    enum: ["cash", "free_delivery", "none"],
    default: "cash",
  },
  used: {
    type: Boolean,
    default: false,
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  spinDate: {
    type: String,
    default: null,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  expired: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
  versionKey: false,
  collection: "wallet_entries",
});

WalletEntrySchema.index({ userId: 1, expired: 1, expiresAt: 1 });
WalletEntrySchema.index({ userId: 1, spinDate: 1 }, { unique: true, sparse: true });
WalletEntrySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const WalletEntry = mongoose.model("WalletEntry", WalletEntrySchema);

export default WalletEntry;
