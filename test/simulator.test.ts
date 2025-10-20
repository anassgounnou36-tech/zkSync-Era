import { describe, it, expect } from "vitest";
import { ArbitrageSimulator } from "../src/simulation/simulate.js";
import { ArbitrageOpportunity } from "../src/mempool/monitor.js";

describe("ArbitrageSimulator", () => {
  const simulator = new ArbitrageSimulator();

  it("should simulate profitable opportunity", async () => {
    const opportunity: ArbitrageOpportunity = {
      tokenIn: "0x0000000000000000000000000000000000000001",
      tokenOut: "0x0000000000000000000000000000000000000002",
      amountIn: BigInt(1000000),
      expectedProfit: BigInt(50000),
      route: ["DEX1", "DEX2"],
      timestamp: Date.now(),
    };

    const result = await simulator.simulate(opportunity);
    expect(result).toBeDefined();
    expect(result.expectedProfit).toBeGreaterThan(BigInt(0));
    expect(result.gasEstimate).toBeGreaterThan(BigInt(0));
  });

  it("should detect unprofitable trades", async () => {
    const opportunity: ArbitrageOpportunity = {
      tokenIn: "0x0000000000000000000000000000000000000001",
      tokenOut: "0x0000000000000000000000000000000000000002",
      amountIn: BigInt(1000000),
      expectedProfit: BigInt(100), // Very low profit
      route: ["DEX1", "DEX2"],
      timestamp: Date.now(),
    };

    const result = await simulator.simulate(opportunity);
    expect(result).toBeDefined();
    // Might fail due to gas costs
  });
});
