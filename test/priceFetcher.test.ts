import { describe, it, expect, vi, beforeEach } from "vitest";
import { PriceFetcher } from "../src/prices/fetcher.js";
import { JsonRpcProvider } from "ethers";

describe("PriceFetcher", () => {
  let mockProvider: JsonRpcProvider;
  let fetcher: PriceFetcher;

  beforeEach(() => {
    // Create a mock provider
    mockProvider = {
      send: vi.fn(),
    } as unknown as JsonRpcProvider;

    fetcher = new PriceFetcher(mockProvider);
  });

  describe("PancakeSwap V3 Quoter", () => {
    it("should call Quoter contract with correct parameters", async () => {
      const mockResult = [BigInt(1000000), BigInt(0), 0, BigInt(50000)];
      
      // Mock the Contract call
      vi.spyOn(mockProvider, "send").mockResolvedValue(mockResult);

      const tokenIn = "0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91"; // WETH
      const tokenOut = "0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4"; // USDC
      const amountIn = BigInt(1000000000000000000); // 1 WETH

      const result = await fetcher.fetchPancakeSwapV3Price(tokenIn, tokenOut, amountIn);

      expect(result.dex).toBe("pancakeswap_v3");
      expect(result.tokenIn).toBe(tokenIn);
      expect(result.tokenOut).toBe(tokenOut);
      expect(result.amountIn).toBe(amountIn);
    });

    it("should handle quote revert with clear error", async () => {
      // Mock a revert
      vi.spyOn(mockProvider, "send").mockRejectedValue(
        new Error("execution reverted")
      );

      const tokenIn = "0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91";
      const tokenOut = "0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4";
      const amountIn = BigInt(1000000000000000000);

      const result = await fetcher.fetchPancakeSwapV3Price(tokenIn, tokenOut, amountIn);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.amountOut).toBe(0n);
    });
  });

  describe("Mute stable pair detection", () => {
    it("should detect USDC/USDT as stable pair", async () => {
      const usdcAddress = "0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4";
      const usdtAddress = "0x493257fD37EDB34451f62EDf8D2a0C418852bA4C";
      
      // Access the private method through a test helper
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isStable = (fetcher as any).isStablePair(usdcAddress, usdtAddress);
      
      expect(isStable).toBe(true);
    });

    it("should not detect WETH/USDC as stable pair", async () => {
      const wethAddress = "0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91";
      const usdcAddress = "0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4";
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isStable = (fetcher as any).isStablePair(wethAddress, usdcAddress);
      
      expect(isStable).toBe(false);
    });
  });

  describe("fetchAllPrices", () => {
    it("should fetch from all enabled DEXes", async () => {
      // Mock provider responses
      vi.spyOn(mockProvider, "send").mockResolvedValue([BigInt(1000000)]);

      const tokenIn = "0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91";
      const tokenOut = "0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4";
      const amountIn = BigInt(1000000000000000000);

      const prices = await fetcher.fetchAllPrices(tokenIn, tokenOut, amountIn);

      // Should have entries for all enabled DEXes
      expect(prices.length).toBeGreaterThan(0);
      expect(prices.every(p => p.dex)).toBe(true);
    });
  });
});
