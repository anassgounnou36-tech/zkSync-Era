import { describe, it, expect } from "vitest";
import {
  mulDiv,
  toBasisPoints,
  applyBasisPointReduction,
  roundDown,
  formatAmount,
  parseAmount,
  calculateGrossSpreadBps,
  applySlippage,
  calculateAmountOutMinimum,
} from "../src/utils/math";

describe("Math Utilities", () => {
  describe("mulDiv", () => {
    it("should multiply and divide correctly", () => {
      const result = mulDiv(100n, 200n, 10n);
      expect(result).toBe(2000n);
    });

    it("should handle large numbers", () => {
      const result = mulDiv(10n ** 18n, 2n, 10n ** 18n);
      expect(result).toBe(2n);
    });
  });

  describe("toBasisPoints", () => {
    it("should convert to basis points correctly", () => {
      const result = toBasisPoints(50n, 1000n);
      expect(result).toBe(500n); // 5%
    });

    it("should handle zero total", () => {
      const result = toBasisPoints(50n, 0n);
      expect(result).toBe(0n);
    });

    it("should calculate 100%", () => {
      const result = toBasisPoints(1000n, 1000n);
      expect(result).toBe(10000n); // 100%
    });
  });

  describe("applyBasisPointReduction", () => {
    it("should reduce amount by basis points", () => {
      const result = applyBasisPointReduction(1000n, 500n); // 5% reduction
      expect(result).toBe(950n);
    });

    it("should handle 0 bps", () => {
      const result = applyBasisPointReduction(1000n, 0n);
      expect(result).toBe(1000n);
    });

    it("should handle 100% reduction", () => {
      const result = applyBasisPointReduction(1000n, 10000n);
      expect(result).toBe(0n);
    });
  });

  describe("roundDown", () => {
    it("should round down to unit", () => {
      const result = roundDown(1234n, 100n);
      expect(result).toBe(1200n);
    });

    it("should handle exact multiples", () => {
      const result = roundDown(1200n, 100n);
      expect(result).toBe(1200n);
    });

    it("should handle unit = 1", () => {
      const result = roundDown(1234n, 1n);
      expect(result).toBe(1234n);
    });
  });

  describe("formatAmount", () => {
    it("should format WETH correctly (18 decimals)", () => {
      const amount = 1n * 10n ** 18n; // 1 WETH
      const result = formatAmount(amount, 18, 6);
      expect(result).toBe("1.000000");
    });

    it("should format USDC correctly (6 decimals)", () => {
      const amount = 1000n * 10n ** 6n; // 1000 USDC
      const result = formatAmount(amount, 6, 6);
      expect(result).toBe("1000.000000");
    });

    it("should handle fractional amounts", () => {
      const amount = 123456789n; // 0.123456789 WETH
      const result = formatAmount(amount, 18, 6);
      expect(result).toBe("0.000000"); // truncated to 6 decimals
    });

    it("should format with custom max decimals", () => {
      const amount = 1500000000000000000n; // 1.5 WETH
      const result = formatAmount(amount, 18, 2);
      expect(result).toBe("1.50");
    });

    it("should handle zero", () => {
      const result = formatAmount(0n, 18, 6);
      expect(result).toBe("0.000000");
    });
  });

  describe("parseAmount", () => {
    it("should parse whole number", () => {
      const result = parseAmount("100", 18);
      expect(result).toBe(100n * 10n ** 18n);
    });

    it("should parse decimal number", () => {
      const result = parseAmount("1.5", 18);
      expect(result).toBe(1500000000000000000n);
    });

    it("should handle USDC (6 decimals)", () => {
      const result = parseAmount("1000.50", 6);
      expect(result).toBe(1000500000n);
    });

    it("should truncate extra decimals", () => {
      const result = parseAmount("1.123456789", 6);
      expect(result).toBe(1123456n);
    });
  });

  describe("calculateGrossSpreadBps", () => {
    it("should calculate positive spread", () => {
      const amountIn = 1000n;
      const amountOut = 1050n; // 5% profit
      const result = calculateGrossSpreadBps(amountIn, amountOut);
      expect(result).toBe(500n); // 5% = 500 bps
    });

    it("should return 0 for no profit", () => {
      const amountIn = 1000n;
      const amountOut = 1000n;
      const result = calculateGrossSpreadBps(amountIn, amountOut);
      expect(result).toBe(0n);
    });

    it("should return 0 for loss", () => {
      const amountIn = 1000n;
      const amountOut = 950n;
      const result = calculateGrossSpreadBps(amountIn, amountOut);
      expect(result).toBe(0n);
    });

    it("should handle zero amountIn", () => {
      const result = calculateGrossSpreadBps(0n, 1000n);
      expect(result).toBe(0n);
    });

    it("should calculate large spread", () => {
      const amountIn = 1000n;
      const amountOut = 2000n; // 100% profit
      const result = calculateGrossSpreadBps(amountIn, amountOut);
      expect(result).toBe(10000n); // 100% = 10000 bps
    });
  });

  describe("applySlippage", () => {
    it("should apply slippage correctly", () => {
      const amount = 1000n;
      const slippageBps = 50n; // 0.5%
      const result = applySlippage(amount, slippageBps);
      expect(result).toBe(995n);
    });

    it("should handle 0 slippage", () => {
      const amount = 1000n;
      const result = applySlippage(amount, 0n);
      expect(result).toBe(1000n);
    });
  });

  describe("calculateAmountOutMinimum", () => {
    it("should calculate amountOutMinimum with slippage and rounding", () => {
      const amountOut = 1000n;
      const slippageBps = 50n; // 0.5%
      const roundingUnit = 10n;
      const result = calculateAmountOutMinimum(amountOut, slippageBps, roundingUnit);
      expect(result).toBe(990n); // 995 rounded down to nearest 10
    });

    it("should handle default rounding unit", () => {
      const amountOut = 1000n;
      const slippageBps = 50n;
      const result = calculateAmountOutMinimum(amountOut, slippageBps);
      expect(result).toBe(995n); // No rounding with unit=1
    });

    it("should round down correctly", () => {
      const amountOut = 1234n;
      const slippageBps = 100n; // 1%
      const roundingUnit = 100n;
      const result = calculateAmountOutMinimum(amountOut, slippageBps, roundingUnit);
      expect(result).toBe(1200n); // 1221.66 rounded down to 1200
    });
  });
});
