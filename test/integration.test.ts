import { describe, it, expect } from "vitest";
import { PriceFetcher } from "../src/prices/fetcher.js";
import { ProfitCalculator } from "../src/simulation/profitCalculator.js";
import dexesConfig from "../config/dexes.json" assert { type: "json" };

const LIVE_TESTS_ENABLED = process.env.ZKSYNC_LIVE_TESTS === "1";

describe("Integration Tests", () => {
  describe("PriceFetcher", () => {
    it.skipIf(!LIVE_TESTS_ENABLED)("should fetch Mute prices from mainnet", async () => {
      const fetcher = new PriceFetcher();
      const weth = dexesConfig.zkSyncEra.tokens.WETH.address;
      const usdc = dexesConfig.zkSyncEra.tokens.USDC.address;
      const amountIn = BigInt("1000000000000000000"); // 1 WETH

      const price = await fetcher.fetchMutePrice(weth, usdc, amountIn);

      if (price.success) {
        expect(price.amountOut).toBeGreaterThan(0n);
        expect(price.price).toBeGreaterThan(0);
        expect(price.dex).toBe("mute");
      } else {
        // Network error is acceptable for live tests
        expect(price.error).toBeDefined();
      }
    }, 30000);

    it.skipIf(!LIVE_TESTS_ENABLED)("should fetch prices from all DEXes", async () => {
      const fetcher = new PriceFetcher();
      const weth = dexesConfig.zkSyncEra.tokens.WETH.address;
      const usdc = dexesConfig.zkSyncEra.tokens.USDC.address;
      const amountIn = BigInt("1000000000000000000"); // 1 WETH

      const prices = await fetcher.fetchAllPrices(weth, usdc, amountIn);

      expect(prices).toBeDefined();
      expect(Array.isArray(prices)).toBe(true);
      expect(prices.length).toBeGreaterThan(0);
    }, 30000);

    it.skipIf(!LIVE_TESTS_ENABLED)("should find arbitrage opportunities", async () => {
      const fetcher = new PriceFetcher();
      const weth = dexesConfig.zkSyncEra.tokens.WETH.address;
      const usdc = dexesConfig.zkSyncEra.tokens.USDC.address;
      const amountIn = BigInt("1000000000000000000"); // 1 WETH

      const opportunity = await fetcher.findArbitrageOpportunity(
        weth,
        usdc,
        amountIn
      );

      // Opportunity may or may not exist
      if (opportunity) {
        expect(opportunity.buyDex).toBeDefined();
        expect(opportunity.sellDex).toBeDefined();
        expect(opportunity.spreadPercent).toBeGreaterThan(0);
      }
    }, 30000);

    it("should get token info from config", () => {
      const fetcher = new PriceFetcher();
      const wethInfo = fetcher.getTokenInfo("WETH");

      expect(wethInfo).toBeDefined();
      expect(wethInfo.address).toBe(dexesConfig.zkSyncEra.tokens.WETH.address);
      expect(wethInfo.decimals).toBe(18);
    });

    it("should get DEX info from config", () => {
      const fetcher = new PriceFetcher();
      const muteInfo = fetcher.getDexInfo("mute");

      expect(muteInfo).toBeDefined();
      expect(muteInfo.name).toBe("Mute.io");
      expect(muteInfo.enabled).toBe(true);
    });
  });

  describe("ProfitCalculator", () => {
    it("should estimate gas cost", () => {
      const calculator = new ProfitCalculator();

      const simpleGas = calculator.estimateGas("simple");
      expect(simpleGas.gasUnits).toBeGreaterThan(0n);
      expect(simpleGas.gasPriceWei).toBeGreaterThan(0n);
      expect(simpleGas.gasCostWei).toBeGreaterThan(0n);

      const complexGas = calculator.estimateGas("complex");
      expect(complexGas.gasUnits).toBeGreaterThan(simpleGas.gasUnits);
    });

    it("should calculate flashloan fee", () => {
      const calculator = new ProfitCalculator();
      const amount = BigInt("1000000000000000000"); // 1 ETH

      // SyncSwap (0 bps)
      const syncSwapFee = calculator.calculateFlashloanFee(amount, 0);
      expect(syncSwapFee).toBe(0n);

      // Generic provider (9 bps)
      const genericFee = calculator.calculateFlashloanFee(amount, 9);
      expect(genericFee).toBe(BigInt("900000000000000")); // 0.0009 ETH
    });

    it("should calculate profit with zero flashloan fee", () => {
      const calculator = new ProfitCalculator();
      const amountIn = BigInt("1000000000000000000"); // 1 ETH
      const amountOut = BigInt("1050000000000000000"); // 1.05 ETH
      const ethPriceUSD = 2000;

      const profit = calculator.calculateProfit({
        amountIn,
        amountOut,
        flashloanFeeBps: 0, // SyncSwap
        ethPriceUSD,
      });

      expect(profit.grossProfit).toBe(BigInt("50000000000000000")); // 0.05 ETH
      expect(profit.flashloanFee).toBe(0n);
      expect(profit.gasCost).toBeGreaterThan(0n);
      expect(profit.netProfit).toBeGreaterThan(0n);
      expect(profit.netProfit).toBeLessThan(profit.grossProfit);
    });

    it("should calculate profit with flashloan fee", () => {
      const calculator = new ProfitCalculator();
      const amountIn = BigInt("1000000000000000000"); // 1 ETH
      const amountOut = BigInt("1050000000000000000"); // 1.05 ETH

      const profit = calculator.calculateProfit({
        amountIn,
        amountOut,
        flashloanFeeBps: 9, // 0.09%
        ethPriceUSD: 2000,
      });

      expect(profit.flashloanFee).toBeGreaterThan(0n);
      expect(profit.netProfit).toBeLessThan(profit.grossProfit - profit.flashloanFee);
    });

    it("should determine profitability based on threshold", () => {
      const calculator = new ProfitCalculator();

      // Profitable trade with high profit margin to account for gas costs
      const amountIn = BigInt("1000000000000000000"); // 1 ETH
      const amountOut = BigInt("1100000000000000000"); // 1.1 ETH (10% profit)
      
      const profit = calculator.calculateProfit({
        amountIn,
        amountOut,
        ethPriceUSD: 2000,
      });

      // 10% profit on 1 ETH at $2000 = $200, well above the minProfitUSD of $3.12
      // Even after gas costs, this should be profitable
      expect(profit.netProfitUSD).toBeGreaterThan(calculator.getConfig().arbitrage.minProfitUSD);
      expect(profit.isProfitable).toBe(true);
    });

    it("should validate trade against safety requirements", () => {
      const calculator = new ProfitCalculator();

      // Valid trade (config has dryRun: false, so this should be valid)
      const validResult = calculator.validateTrade({
        profitUSD: 10,
        gasPrice: BigInt("10000000000"), // 10 gwei
        slippage: 0.003, // 0.3%
      });

      // Should be valid since all parameters are within limits and dryRun is false
      expect(validResult.valid).toBe(true);
      expect(validResult.reasons.length).toBe(0);

      // Invalid trade - insufficient profit
      const lowProfitResult = calculator.validateTrade({
        profitUSD: 1, // Below minimum of 3.12
        gasPrice: BigInt("10000000000"),
        slippage: 0.003,
      });

      expect(lowProfitResult.valid).toBe(false);
      expect(lowProfitResult.reasons.some(r => r.includes("Profit"))).toBe(true);

      // Invalid trade - high gas price
      const invalidGasResult = calculator.validateTrade({
        profitUSD: 10,
        gasPrice: BigInt("100000000000"), // 100 gwei (exceeds max)
        slippage: 0.003,
      });

      expect(invalidGasResult.valid).toBe(false);
      expect(invalidGasResult.reasons.length).toBeGreaterThan(0);
      expect(invalidGasResult.reasons.some(r => r.includes("Gas price"))).toBe(true);
    });

    it("should calculate daily revenue projections", () => {
      const calculator = new ProfitCalculator();
      const config = calculator.getConfig();

      const revenue = calculator.calculateDailyRevenue({
        avgProfitPerTrade: 5, // $5 per trade
      });

      expect(revenue.totalOpportunities).toBe(config.arbitrage.expectedDailyOpportunities);
      expect(revenue.capturedTrades).toBe(
        Math.floor(config.arbitrage.expectedDailyOpportunities * config.arbitrage.targetCaptureRate)
      );
      expect(revenue.dailyRevenueUSD).toBeGreaterThan(0);
    });

    it("should handle zero profit scenario", () => {
      const calculator = new ProfitCalculator();
      const amountIn = BigInt("1000000000000000000"); // 1 ETH
      const amountOut = BigInt("900000000000000000"); // 0.9 ETH (loss)

      const profit = calculator.calculateProfit({
        amountIn,
        amountOut,
        ethPriceUSD: 2000,
      });

      expect(profit.grossProfit).toBe(0n);
      expect(profit.netProfit).toBe(0n);
      expect(profit.isProfitable).toBe(false);
    });

    it("should get config", () => {
      const calculator = new ProfitCalculator();
      const config = calculator.getConfig();

      expect(config).toBeDefined();
      expect(config.arbitrage).toBeDefined();
      expect(config.safety).toBeDefined();
      expect(config.arbitrage.minProfitUSD).toBe(3.12);
    });
  });
});
