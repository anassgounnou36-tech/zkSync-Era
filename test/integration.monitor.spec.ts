import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProfitCalculator } from "../src/simulation/profitCalculator.js";
import { PriceGapMonitor } from "../src/monitoring/priceGapMonitor.js";
import * as fs from "fs";

describe("Monitoring Integration Tests", () => {
  describe("ProfitCalculator - Orchestration Decision Making", () => {
    let calculator: ProfitCalculator;

    beforeEach(() => {
      calculator = new ProfitCalculator();
    });

    it("should validate profitable trade with all safety checks", () => {
      const profitEstimate = calculator.calculateProfit({
        amountIn: BigInt("1000000000000000000"), // 1 ETH
        amountOut: BigInt("1100000000000000000"), // 1.1 ETH
        flashloanFeeBps: 0,
        ethPriceUSD: 2000,
      });

      const validation = calculator.validateTrade({
        profitUSD: profitEstimate.netProfitUSD,
        gasPrice: BigInt("10000000000"), // 10 gwei
        slippage: 0.003,
      });

      expect(profitEstimate.isProfitable).toBe(true);
      expect(validation.valid).toBe(true);
      expect(validation.reasons).toHaveLength(0);
    });

    it("should reject trade with insufficient profit", () => {
      const profitEstimate = calculator.calculateProfit({
        amountIn: BigInt("1000000000000000000"), // 1 ETH
        amountOut: BigInt("1001000000000000000"), // 1.001 ETH (minimal profit)
        flashloanFeeBps: 0,
        ethPriceUSD: 2000,
      });

      // Low profit should fail validation
      expect(profitEstimate.netProfitUSD).toBeLessThan(calculator.getConfig().arbitrage.minProfitUSD);
      expect(profitEstimate.isProfitable).toBe(false);
    });

    it("should reject trade with high gas price", () => {
      const profitEstimate = calculator.calculateProfit({
        amountIn: BigInt("1000000000000000000"),
        amountOut: BigInt("1100000000000000000"),
        flashloanFeeBps: 0,
        ethPriceUSD: 2000,
      });

      const validation = calculator.validateTrade({
        profitUSD: profitEstimate.netProfitUSD,
        gasPrice: BigInt("100000000000"), // 100 gwei (too high)
        slippage: 0.003,
      });

      expect(validation.valid).toBe(false);
      expect(validation.reasons.some(r => r.includes("Gas price"))).toBe(true);
    });

    it("should reject trade with excessive slippage", () => {
      const profitEstimate = calculator.calculateProfit({
        amountIn: BigInt("1000000000000000000"),
        amountOut: BigInt("1100000000000000000"),
        flashloanFeeBps: 0,
        ethPriceUSD: 2000,
      });

      const validation = calculator.validateTrade({
        profitUSD: profitEstimate.netProfitUSD,
        gasPrice: BigInt("10000000000"),
        slippage: 0.01, // 1% slippage (above 0.5% max)
      });

      expect(validation.valid).toBe(false);
      expect(validation.reasons.some(r => r.includes("Slippage"))).toBe(true);
    });

    it("should calculate correct flashloan fees for different providers", () => {
      const amount = BigInt("1000000000000000000"); // 1 ETH

      // SyncSwap (0 bps)
      const syncSwapFee = calculator.calculateFlashloanFee(amount, 0);
      expect(syncSwapFee).toBe(0n);

      // Balancer (5 bps)
      const balancerFee = calculator.calculateFlashloanFee(amount, 5);
      expect(balancerFee).toBe(BigInt("500000000000000")); // 0.0005 ETH

      // Aave (9 bps)
      const aaveFee = calculator.calculateFlashloanFee(amount, 9);
      expect(aaveFee).toBe(BigInt("900000000000000")); // 0.0009 ETH
    });

    it("should estimate gas costs correctly for different complexities", () => {
      const simpleGas = calculator.estimateGas("simple");
      const complexGas = calculator.estimateGas("complex");

      expect(complexGas.gasUnits).toBeGreaterThan(simpleGas.gasUnits);
      expect(complexGas.gasCostWei).toBeGreaterThan(simpleGas.gasCostWei);
      
      // Complex should include flashloan overhead
      expect(complexGas.gasUnits).toBeGreaterThan(400000n); // Base + 2 swaps + flashloan
    });

    it("should calculate daily revenue projections", () => {
      const revenue = calculator.calculateDailyRevenue({
        avgProfitPerTrade: 5,
        captureRate: 0.2,
      });

      const config = calculator.getConfig();
      expect(revenue.totalOpportunities).toBe(config.arbitrage.expectedDailyOpportunities);
      expect(revenue.capturedTrades).toBe(Math.floor(1318 * 0.2)); // 263 trades
      expect(revenue.dailyRevenueUSD).toBe(263 * 5); // $1,315
    });

    it("should handle edge case: zero profit scenario", () => {
      const profitEstimate = calculator.calculateProfit({
        amountIn: BigInt("1000000000000000000"),
        amountOut: BigInt("1000000000000000000"), // Same amount
        flashloanFeeBps: 0,
        ethPriceUSD: 2000,
      });

      expect(profitEstimate.grossProfit).toBe(0n);
      expect(profitEstimate.netProfit).toBe(0n);
      expect(profitEstimate.isProfitable).toBe(false);
    });

    it("should handle edge case: loss scenario", () => {
      const profitEstimate = calculator.calculateProfit({
        amountIn: BigInt("1000000000000000000"),
        amountOut: BigInt("900000000000000000"), // Loss
        flashloanFeeBps: 0,
        ethPriceUSD: 2000,
      });

      expect(profitEstimate.grossProfit).toBe(0n);
      expect(profitEstimate.netProfit).toBe(0n);
      expect(profitEstimate.isProfitable).toBe(false);
    });

    it("should account for gas costs in net profit", () => {
      const profitEstimate = calculator.calculateProfit({
        amountIn: BigInt("1000000000000000000"),
        amountOut: BigInt("1010000000000000000"), // 1.01 ETH
        flashloanFeeBps: 0,
        ethPriceUSD: 2000,
      });

      // Net profit should be less than gross profit due to gas
      expect(profitEstimate.netProfit).toBeLessThan(profitEstimate.grossProfit);
      expect(profitEstimate.gasCost).toBeGreaterThan(0n);
    });
  });

  describe("PriceGapMonitor - Database Operations", () => {
    const testDbPath = "./data/test-monitoring.sqlite";
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Set required environment variable for RPC
      process.env.ZKSYNC_RPC_HTTP = "https://test-rpc.example.com";
      
      // Clean up test database if it exists
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    afterEach(() => {
      // Restore original environment
      process.env = { ...originalEnv };
    });

    it("should initialize database with correct schema", () => {
      const monitor = new PriceGapMonitor(testDbPath);
      
      // Verify database file was created
      expect(fs.existsSync(testDbPath)).toBe(true);
      
      monitor.close();
    });

    it("should generate empty report for new database", () => {
      const monitor = new PriceGapMonitor(testDbPath);
      
      const report = monitor.generateReport();
      
      expect(report.totalOpportunities).toBe(0);
      expect(report.closedOpportunities).toBe(0);
      expect(report.hourlyStats).toBeInstanceOf(Array);
      expect(report.topOpportunities).toHaveLength(0);
      
      monitor.close();
    });

    it("should save report to JSON file", () => {
      const monitor = new PriceGapMonitor(testDbPath);
      const reportPath = "./test-report.json";
      
      // Clean up if exists
      if (fs.existsSync(reportPath)) {
        fs.unlinkSync(reportPath);
      }
      
      monitor.saveReport(reportPath);
      
      // Verify file was created
      expect(fs.existsSync(reportPath)).toBe(true);
      
      // Verify JSON structure
      const reportData = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      expect(reportData).toHaveProperty("startTime");
      expect(reportData).toHaveProperty("endTime");
      expect(reportData).toHaveProperty("totalOpportunities");
      expect(reportData).toHaveProperty("hourlyStats");
      
      // Clean up
      monitor.close();
      fs.unlinkSync(reportPath);
    });

    it("should handle database path with directories", () => {
      const nestedDbPath = "./data/test/nested/monitoring.sqlite";
      
      // Clean up if exists
      if (fs.existsSync(nestedDbPath)) {
        fs.unlinkSync(nestedDbPath);
      }
      
      const monitor = new PriceGapMonitor(nestedDbPath);
      
      expect(fs.existsSync(nestedDbPath)).toBe(true);
      
      monitor.close();
      
      // Clean up - just remove the file, leave directories
      fs.unlinkSync(nestedDbPath);
    });
  });

  describe("Orchestration Decision Logic", () => {
    it("should make correct execution decision with multiple factors", () => {
      const calculator = new ProfitCalculator();
      
      // Scenario: High-profit opportunity with acceptable conditions
      const highProfitScenario = {
        amountIn: BigInt("2000000000000000000"), // 2 ETH
        amountOut: BigInt("2200000000000000000"), // 2.2 ETH (10% profit)
        ethPriceUSD: 2000,
      };
      
      const profit = calculator.calculateProfit(highProfitScenario);
      const validation = calculator.validateTrade({
        profitUSD: profit.netProfitUSD,
        gasPrice: BigInt("15000000000"), // 15 gwei
        slippage: 0.004, // 0.4%
      });
      
      // Should be profitable and pass validation
      expect(profit.isProfitable).toBe(true);
      expect(validation.valid).toBe(true);
      
      // Profit should be substantial
      expect(profit.netProfitUSD).toBeGreaterThan(100); // Over $100
    });

    it("should reject marginal opportunities", () => {
      const calculator = new ProfitCalculator();
      
      // Scenario: Marginal profit that doesn't cover costs
      const marginalScenario = {
        amountIn: BigInt("1000000000000000000"), // 1 ETH
        amountOut: BigInt("1002000000000000000"), // 1.002 ETH (0.2% profit)
        ethPriceUSD: 2000,
      };
      
      const profit = calculator.calculateProfit(marginalScenario);
      
      // Gas costs should eat up the profit
      expect(profit.isProfitable).toBe(false);
      expect(profit.netProfitUSD).toBeLessThan(calculator.getConfig().arbitrage.minProfitUSD);
    });
  });
});
