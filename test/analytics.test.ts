import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AnalyticsDB, TradeRecord } from "../src/analytics/db.js";
import * as fs from "fs";

describe("AnalyticsDB", () => {
  const testDbPath = "/tmp/test-analytics.sqlite";
  let db: AnalyticsDB;

  beforeAll(() => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    db = new AnalyticsDB(testDbPath);
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  it("should initialize database", () => {
    expect(fs.existsSync(testDbPath)).toBe(true);
  });

  it("should record a trade", () => {
    const trade: TradeRecord = {
      timestamp: Date.now(),
      tokenIn: "0x0000000000000000000000000000000000000001",
      tokenOut: "0x0000000000000000000000000000000000000002",
      amountIn: "1000000",
      amountOut: "1050000",
      profit: "50000",
      gasUsed: "500000",
      txHash: "0x" + "1".repeat(64),
    };

    db.recordTrade(trade);
    const count = db.getTradeCount();
    expect(count).toBe(1);
  });

  it("should calculate total PnL", () => {
    const totalPnL = db.getTotalPnL();
    expect(totalPnL).toBeGreaterThanOrEqual(BigInt(0));
  });

  it("should retrieve recent trades", () => {
    const trades = db.getRecentTrades(5);
    expect(Array.isArray(trades)).toBe(true);
    expect(trades.length).toBeGreaterThan(0);
  });
});
