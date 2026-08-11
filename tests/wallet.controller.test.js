import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const VALID_OBJECT_ID = "507f1f77bcf86cd799439011";

const mockCreate = jest.fn();
const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockUpdateMany = jest.fn();
const mockCountDocuments = jest.fn();
const mockAggregate = jest.fn();
const mockFind = jest.fn();

jest.unstable_mockModule("../src/models/WalletEntry.model.js", () => ({
  default: {
    create: mockCreate,
    findOne: mockFindOne,
    findOneAndUpdate: mockFindOneAndUpdate,
    find: mockFind,
    updateMany: mockUpdateMany,
    countDocuments: mockCountDocuments,
    aggregate: mockAggregate,
  },
}));

const { creditOrderInternal, creditWalletSpinWin, redeemWallet, consumeFreeDeliveryInternal } = await import("../src/controllers/wallet.controller.js");

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const thenableQuery = (data) => {
  const q = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(data),
    then: (resolve, reject) => Promise.resolve(data).then(resolve, reject),
  };
  return q;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ modifiedCount: 0 });
  mockAggregate.mockResolvedValue([]);
  mockFind.mockReturnValue(thenableQuery([]));
  mockCreate.mockResolvedValue({ _id: "test-entry" });
});

describe("creditOrderInternal", () => {
  it("should require orderId and userId", async () => {
    const req = { body: {} };
    const res = mockResponse();

    await creditOrderInternal(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("should reject invalid userId or orderId", async () => {
    const req = { body: { userId: "not-an-id", orderId: VALID_OBJECT_ID } };
    const res = mockResponse();

    await creditOrderInternal(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should credit the wallet for a valid internal call", async () => {
    mockCreate.mockResolvedValue({ _id: "entry-1", amount: 10 });
    const req = { body: { userId: VALID_OBJECT_ID, orderId: VALID_OBJECT_ID } };
    const res = mockResponse();

    await creditOrderInternal(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      userId: VALID_OBJECT_ID,
      amount: 10,
      remainingAmount: 10,
      source: "order",
      orderId: VALID_OBJECT_ID,
    }));
  });

  it("should not double-credit the same order", async () => {
    mockFindOne.mockResolvedValue({ _id: "existing-entry", amount: 10, source: "order" });
    const req = { body: { userId: VALID_OBJECT_ID, orderId: VALID_OBJECT_ID } };
    const res = mockResponse();

    await creditOrderInternal(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ alreadyCredited: true }));
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("creditWalletSpinWin", () => {
  it("should credit cash prize when the cash outcome is picked", async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ _id: "spin-2", amount: 10 });
    jest.spyOn(Math, "random").mockReturnValue(0.5);
    const req = { user: { id: "user-1" }, body: { amount: 999999 } };
    const res = mockResponse();

    await creditWalletSpinWin(req, res);

    jest.spyOn(Math, "random").mockRestore();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const created = mockCreate.mock.calls[0][0];
    expect(created.prizeType).toBe("cash");
    expect([5, 7, 9, 10]).toContain(created.amount);
    expect(created.amount).not.toBe(999999);
    expect(created).toEqual(expect.objectContaining({
      userId: "user-1",
      source: "spin_win",
      spinDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
    const respData = res.json.mock.calls[0][0].data;
    expect(respData.prize.type).toBe("cash");
    expect([5, 7, 9, 10]).toContain(respData.prize.amount);
  });

  it("should grant a free delivery coupon when the free_delivery outcome is picked", async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ _id: "spin-3" });
    jest.spyOn(Math, "random").mockReturnValue(4 / 6);
    const req = { user: { id: "user-1" }, body: {} };
    const res = mockResponse();

    await creditWalletSpinWin(req, res);

    jest.spyOn(Math, "random").mockRestore();
    const created = mockCreate.mock.calls[0][0];
    expect(created.prizeType).toBe("free_delivery");
    expect(created.amount).toBe(0);
    expect(created.remainingAmount).toBe(0);
    const respData = res.json.mock.calls[0][0].data;
    expect(respData.prize).toEqual({ type: "free_delivery" });
  });

  it("should record a better-luck spin without cash when the none outcome is picked", async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ _id: "spin-4" });
    jest.spyOn(Math, "random").mockReturnValue(0.9);
    const req = { user: { id: "user-1" }, body: {} };
    const res = mockResponse();

    await creditWalletSpinWin(req, res);

    jest.spyOn(Math, "random").mockRestore();
    const created = mockCreate.mock.calls[0][0];
    expect(created.prizeType).toBe("none");
    expect(created.amount).toBe(0);
    expect(created.remainingAmount).toBe(0);
    const respData = res.json.mock.calls[0][0].data;
    expect(respData.prize).toEqual({ type: "none" });
  });

  it("should reject a second spin on the same day", async () => {
    mockFindOne.mockResolvedValue({ _id: "spin-1" });
    const req = { user: { id: "user-1" }, body: { amount: 20 } };
    const res = mockResponse();

    await creditWalletSpinWin(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Already spun today. Come back tomorrow!" }));
  });

  it("should credit winnings when no spin exists today", async () => {
    mockFindOne.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ _id: "spin-2", amount: 10 });
    jest.spyOn(Math, "random").mockReturnValue(0);
    const req = { user: { id: "user-1" }, body: { amount: 20 } };
    const res = mockResponse();

    await creditWalletSpinWin(req, res);

    jest.spyOn(Math, "random").mockRestore();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      source: "spin_win",
      spinDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
  });

  it("should handle a duplicate-key race by returning already-spun", async () => {
    mockFindOne.mockResolvedValue(null);
    const dupError = new Error("duplicate key");
    dupError.code = 11000;
    mockCreate.mockRejectedValue(dupError);
    const req = { user: { id: "user-1" }, body: { amount: 20 } };
    const res = mockResponse();

    await creditWalletSpinWin(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Already spun today. Come back tomorrow!" }));
  });
});

describe("consumeFreeDeliveryInternal", () => {
  it("should reject an invalid userId", async () => {
    const req = { body: { userId: "not-an-id" } };
    const res = mockResponse();

    await consumeFreeDeliveryInternal(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should consume the active free delivery coupon", async () => {
    mockFindOneAndUpdate.mockResolvedValue({ _id: "fd-1", prizeType: "free_delivery", used: true });
    const req = { body: { userId: VALID_OBJECT_ID } };
    const res = mockResponse();

    await consumeFreeDeliveryInternal(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ consumed: true }),
    }));
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ userId: VALID_OBJECT_ID, prizeType: "free_delivery", used: false }),
      { $set: { used: true } },
      expect.any(Object)
    );
  });

  it("should return 400 when no active free delivery coupon exists", async () => {
    mockFindOneAndUpdate.mockResolvedValue(null);
    const req = { body: { userId: VALID_OBJECT_ID } };
    const res = mockResponse();

    await consumeFreeDeliveryInternal(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "No active free delivery coupon" }));
  });
});

describe("redeemWallet", () => {
  it("should reject when the amount exceeds the balance", async () => {
    mockFind.mockReturnValue(thenableQuery([{ _id: "e1", remainingAmount: 10 }]));
    const req = { user: { id: "user-1" }, body: { amount: 50, orderId: "o1" } };
    const res = mockResponse();

    await redeemWallet(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("should atomically deduct across entries", async () => {
    mockFind.mockReturnValue(thenableQuery([
      { _id: "e1", remainingAmount: 100 },
      { _id: "e2", remainingAmount: 50 },
    ]));
    mockFindOneAndUpdate.mockResolvedValue({ _id: "e1", remainingAmount: 0 });
    mockCreate.mockResolvedValue({ _id: "redeem-1" });
    const req = { user: { id: "user-1" }, body: { amount: 120, orderId: "o1" } };
    const res = mockResponse();

    await redeemWallet(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: "e1", remainingAmount: { $gte: 100 } },
      { $inc: { remainingAmount: -100 } },
      { new: true }
    );
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: "e2", remainingAmount: { $gte: 20 } },
      { $inc: { remainingAmount: -20 } },
      { new: true }
    );
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ source: "redeem", amount: 120 }));
  });

  it("should reject if a concurrent redemption consumed the balance", async () => {
    mockFind.mockReturnValue(thenableQuery([{ _id: "e1", remainingAmount: 100 }]));
    mockFindOneAndUpdate.mockResolvedValue(null);
    const req = { user: { id: "user-1" }, body: { amount: 50, orderId: "o1" } };
    const res = mockResponse();

    await redeemWallet(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Insufficient balance" }));
  });
});
