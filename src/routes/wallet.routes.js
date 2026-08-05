import express from "express";
import * as walletController from "../controllers/wallet.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/balance", authenticate, walletController.getWalletBalance);
router.get("/transactions", authenticate, walletController.getWalletTransactions);
router.get("/spin-check", authenticate, walletController.checkSpinAvailable);
router.post("/spin-win", authenticate, walletController.creditWalletSpinWin);
router.post("/redeem", authenticate, walletController.redeemWallet);
router.post("/credit-order", authenticate, walletController.creditOrderInternal);

export default router;
