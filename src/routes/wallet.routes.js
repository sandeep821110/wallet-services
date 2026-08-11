import express from "express";
import * as walletController from "../controllers/wallet.controller.js";
import { authenticate, verifyInternalToken } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/balance", authenticate, walletController.getWalletBalance);
router.get("/entries", authenticate, walletController.getWalletActiveEntries);
router.get("/transactions", authenticate, walletController.getWalletTransactions);
router.get("/spin-check", authenticate, walletController.checkSpinAvailable);
router.post("/spin-win", authenticate, walletController.creditWalletSpinWin);
router.post("/redeem", authenticate, walletController.redeemWallet);
router.get("/free-delivery", authenticate, walletController.getFreeDeliveryStatus);

// Internal routes - used by the order service (shared internal token)
router.get("/internal/balance/:userId", verifyInternalToken, walletController.getBalanceInternal);
router.post("/credit-order", verifyInternalToken, walletController.creditOrderInternal);
router.post("/internal/consume-free-delivery", verifyInternalToken, walletController.consumeFreeDeliveryInternal);

export default router;
