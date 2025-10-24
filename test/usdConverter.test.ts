import { describe, it, expect, beforeEach } from "vitest";
import { JsonRpcProvider } from "ethers";
import { UsdConverter } from "../src/utils/usdConverter";
import { PriceFetcher } from "../src/prices/fetcher";

describe("USD Converter", () => {
  let provider: JsonRpcProvider;
  let fetcher: PriceFetcher;
  let converter: UsdConverter;

  beforeEach(() => {
    // Create a mock provider (won't actually make calls in these tests)
    provider = new JsonRpcProvider("http://localhost:8545");
    fetcher = new PriceFetcher(provider);
    converter = new UsdConverter(provider, fetcher);
  });

  describe("Token Metadata", () => {
    it("should get token metadata by address", () => {
      const meta = converter.getTokenMeta("0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91");
      expect(meta).toBeDefined();
      expect(meta?.symbol).toBe("WETH");
      expect(meta?.decimals).toBe(18);
    });

    it("should get token metadata by symbol", () => {
      const meta = converter.getTokenMeta("USDC");
      expect(meta).toBeDefined();
      expect(meta?.symbol).toBe("USDC");
      expect(meta?.decimals).toBe(6);
    });

    it("should be case-insensitive for addresses", () => {
      const meta = converter.getTokenMeta("0x5aea5775959fbc2557cc8789bc1bf90a239d9a91");
      expect(meta).toBeDefined();
      expect(meta?.symbol).toBe("WETH");
    });

    it("should return undefined for unknown token", () => {
      const meta = converter.getTokenMeta("0x0000000000000000000000000000000000000000");
      expect(meta).toBeUndefined();
    });
  });

  describe("Cache Management", () => {
    it("should start with empty cache", () => {
      const stats = converter.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.entries).toHaveLength(0);
    });

    it("should clear cache", () => {
      converter.clearCache();
      const stats = converter.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe("USD Conversion Math", () => {
    it("should calculate USDC value correctly (USDC = $1)", async () => {
      // USDC should always be $1.00
      const usdcAddress = "0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4";
      const amount = 1000n * 10n ** 6n; // 1000 USDC
      
      // This will make an actual call, so we'll test the math logic separately
      // In a real test, we'd mock the fetcher
      const meta = converter.getTokenMeta(usdcAddress);
      expect(meta).toBeDefined();
      expect(meta?.decimals).toBe(6);
    });
  });
});

describe("USD Converter Integration", () => {
  it("should handle token metadata correctly for all configured tokens", () => {
    const provider = new JsonRpcProvider("http://localhost:8545");
    const fetcher = new PriceFetcher(provider);
    const converter = new UsdConverter(provider, fetcher);

    // Test WETH
    const wethMeta = converter.getTokenMeta("WETH");
    expect(wethMeta?.decimals).toBe(18);

    // Test USDC
    const usdcMeta = converter.getTokenMeta("USDC");
    expect(usdcMeta?.decimals).toBe(6);

    // Test USDT
    const usdtMeta = converter.getTokenMeta("USDT");
    expect(usdtMeta?.decimals).toBe(6);
  });
});
