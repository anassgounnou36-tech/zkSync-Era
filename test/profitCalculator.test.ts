import { describe, it, expect } from "vitest";
import { ProfitCalculator } from "../src/simulation/profitCalculator.js";

describe("ProfitCalculator", () => {
  const calculator = new ProfitCalculator();

  it("should calculate positive net profit", () => {
    const result = calculator.calculateProfit({
      amountIn: BigInt(1e18), // 1 ETH
      amountOut: BigInt(1.1e18), // 1.1 ETH
      flashloanFeeBps: 0,
      ethPriceUSD: 2000,
    });

    expect(result.grossProfit).toBeGreaterThan(0n);
    expect(result.netProfit).toBeGreaterThan(0n);
    expect(result.netProfitUSD).toBeGreaterThan(0);
    expect(result.profitMarginPercent).toBeGreaterThan(0);
  });

  it("should detect unprofitable trades", () => {
    const result = calculator.calculateProfit({
      amountIn: BigInt(1e18), // 1 ETH
      amountOut: BigInt(1.001e18), // 1.001 ETH (very small profit)
      flashloanFeeBps: 0,
      ethPriceUSD: 2000,
    });

    // Small profit might be unprofitable after gas costs
    expect(result.isProfitable).toBe(false);
  });

  it("should handle zero profit", () => {
    const result = calculator.calculateProfit({
      amountIn: BigInt(1e18),
      amountOut: BigInt(1e18), // Same amount
      flashloanFeeBps: 0,
      ethPriceUSD: 2000,
    });

    expect(result.grossProfit).toBe(0n);
    expect(result.netProfit).toBe(0n);
    expect(result.isProfitable).toBe(false);
  });

  it("should calculate gas estimates correctly", () => {
    const simpleGas = calculator.estimateGas("simple");
    const complexGas = calculator.estimateGas("complex");

    expect(simpleGas.gasUnits).toBeGreaterThan(0n);
    expect(complexGas.gasUnits).toBeGreaterThan(simpleGas.gasUnits);
    expect(simpleGas.gasCostWei).toBeGreaterThan(0n);
  });

  it("should validate trade requirements", () => {
    const valid = calculator.validateTrade({
      profitUSD: 50, // Above minimum
      gasPrice: BigInt(1e9), // Reasonable gas price
      slippage: 0.005, // 0.5%
    });

    // With profitUSD above minimum (3.12), reasonable gas price and slippage,
    // and dryRun=false, trade should be valid
    expect(valid.valid).toBe(true);
    expect(valid.reasons.length).toBe(0);
  });

  it("should calculate flashloan fee", () => {
    const amount = BigInt(1e18);
    const feeBps = 30; // 0.3%
    const fee = calculator.calculateFlashloanFee(amount, feeBps);

    expect(fee).toBe((amount * 30n) / 10000n);
  });
});
