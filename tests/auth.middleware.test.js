import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import jwt from "jsonwebtoken";

const SECRET = "wallet-test-secret";

const { authenticate, verifyInternalToken } = await import("../src/middleware/auth.middleware.js");

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = SECRET;
  process.env.INTERNAL_API_SECRET = "internal-secret";
  jest.clearAllMocks();
});

afterEach(() => {
  delete process.env.JWT_ACCESS_SECRET;
  delete process.env.JWT_SECRET;
  delete process.env.INTERNAL_API_SECRET;
});

describe("authenticate", () => {
  it("should return 401 when no token is provided", () => {
    const req = { headers: {} };
    const res = mockResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 for an invalid token", () => {
    const req = { headers: { authorization: "Bearer garbage" } };
    const res = mockResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should authenticate a valid token", () => {
    const token = jwt.sign({ id: "user-1", role: "user" }, SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({ id: "user-1", role: "user" });
    expect(req.userId).toBe("user-1");
  });

  it("should fail closed when the secret is not configured", () => {
    delete process.env.JWT_ACCESS_SECRET;
    const token = jwt.sign({ id: "user-1" }, SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockResponse();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("verifyInternalToken", () => {
  it("should return 503 when INTERNAL_API_SECRET is not configured", () => {
    delete process.env.INTERNAL_API_SECRET;
    const req = { headers: {} };
    const res = mockResponse();
    const next = jest.fn();

    verifyInternalToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("should reject a missing or wrong token", () => {
    const req = { headers: {} };
    const res = mockResponse();
    const next = jest.fn();

    verifyInternalToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("should allow the correct internal token", () => {
    const req = { headers: { "x-internal-token": "internal-secret" } };
    const res = mockResponse();
    const next = jest.fn();

    verifyInternalToken(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
