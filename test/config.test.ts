import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config/config.js";

describe("Config", () => {
  it("should load default config", () => {
    const config = loadConfig();
    expect(config).toBeDefined();
    expect(config.dryRun).toBe(true);
    expect(config.logLevel).toBe("info");
  });

  it("should have valid defaults", () => {
    const config = loadConfig();
    expect(config.minProfitThresholdUsd).toBeGreaterThan(0);
    expect(config.maxSlippageBps).toBeGreaterThan(0);
    expect(config.gasPriceMultiplier).toBeGreaterThan(0);
  });
});
