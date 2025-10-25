import { describe, it, expect } from "vitest";
import { DEXTokenResolver } from "../src/prices/tokenResolver.js";
import dexesConfig from "../config/dexes.json" assert { type: "json" };

describe("DEXTokenResolver", () => {
  const resolver = new DEXTokenResolver();
  const config = dexesConfig.zkSyncEra;

  const USDC_NATIVE = config.tokens.USDC.address;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const USDC_BRIDGED = (config.tokens as any)["USDC.e"].address;
  const WETH = config.tokens.WETH.address;
  const USDT = config.tokens.USDT.address;

  describe("Token identification", () => {
    it("should identify native USDC", () => {
      expect(resolver.isUSDC(USDC_NATIVE)).toBe(true);
      expect(resolver.getTokenSymbol(USDC_NATIVE)).toBe("USDC");
    });

    it("should identify bridged USDC.e", () => {
      expect(resolver.isUSDC(USDC_BRIDGED)).toBe(true);
      expect(resolver.getTokenSymbol(USDC_BRIDGED)).toBe("USDC.e");
    });

    it("should not identify non-USDC tokens", () => {
      expect(resolver.isUSDC(WETH)).toBe(false);
      expect(resolver.isUSDC(USDT)).toBe(false);
    });

    it("should detect pairs involving USDC", () => {
      expect(resolver.pairInvolvesUSDC(USDC_NATIVE, USDT)).toBe(true);
      expect(resolver.pairInvolvesUSDC(USDC_BRIDGED, USDT)).toBe(true);
      expect(resolver.pairInvolvesUSDC(WETH, USDC_NATIVE)).toBe(true);
      expect(resolver.pairInvolvesUSDC(WETH, USDT)).toBe(false);
    });
  });

  describe("Token alternatives", () => {
    it("should return USDC.e as alternative for native USDC", () => {
      const alt = resolver.getAlternative(USDC_NATIVE);
      expect(alt).toBe(USDC_BRIDGED.toLowerCase());
    });

    it("should return native USDC as alternative for USDC.e", () => {
      const alt = resolver.getAlternative(USDC_BRIDGED);
      expect(alt).toBe(USDC_NATIVE.toLowerCase());
    });

    it("should return null for non-USDC tokens", () => {
      expect(resolver.getAlternative(WETH)).toBeNull();
      expect(resolver.getAlternative(USDT)).toBeNull();
    });
  });

  describe("Token resolution with policy=off", () => {
    it("should not modify tokens", () => {
      const result = resolver.resolve("test_dex", USDC_NATIVE, USDT, "off");
      expect(result.tokenIn).toBe(USDC_NATIVE);
      expect(result.tokenOut).toBe(USDT);
      expect(result.resolvedFrom.tokenIn).toBe("original");
      expect(result.resolvedFrom.tokenOut).toBe("original");
    });
  });

  describe("Token resolution with policy=force-native", () => {
    it("should replace bridged USDC with native USDC", () => {
      const result = resolver.resolve("test_dex", USDC_BRIDGED, USDT, "force-native");
      expect(result.tokenIn.toLowerCase()).toBe(USDC_NATIVE.toLowerCase());
      expect(result.tokenOut).toBe(USDT);
      expect(result.resolvedFrom.tokenIn).toBe("native");
      expect(result.resolvedFrom.tokenOut).toBe("original");
    });

    it("should keep native USDC as-is", () => {
      const result = resolver.resolve("test_dex", USDC_NATIVE, USDT, "force-native");
      expect(result.tokenIn).toBe(USDC_NATIVE);
      expect(result.tokenOut).toBe(USDT);
      expect(result.resolvedFrom.tokenIn).toBe("original");
    });

    it("should replace both tokens if both are bridged", () => {
      const result = resolver.resolve("test_dex", USDC_BRIDGED, USDC_BRIDGED, "force-native");
      expect(result.tokenIn.toLowerCase()).toBe(USDC_NATIVE.toLowerCase());
      expect(result.tokenOut.toLowerCase()).toBe(USDC_NATIVE.toLowerCase());
      expect(result.resolvedFrom.tokenIn).toBe("native");
      expect(result.resolvedFrom.tokenOut).toBe("native");
    });
  });

  describe("Token resolution with policy=force-bridged", () => {
    it("should replace native USDC with bridged USDC", () => {
      const result = resolver.resolve("test_dex", USDC_NATIVE, USDT, "force-bridged");
      expect(result.tokenIn.toLowerCase()).toBe(USDC_BRIDGED.toLowerCase());
      expect(result.tokenOut).toBe(USDT);
      expect(result.resolvedFrom.tokenIn).toBe("bridged");
      expect(result.resolvedFrom.tokenOut).toBe("original");
    });

    it("should keep bridged USDC as-is", () => {
      const result = resolver.resolve("test_dex", USDC_BRIDGED, USDT, "force-bridged");
      expect(result.tokenIn).toBe(USDC_BRIDGED);
      expect(result.tokenOut).toBe(USDT);
      expect(result.resolvedFrom.tokenIn).toBe("original");
    });
  });

  describe("Token resolution with policy=auto", () => {
    it("should not modify tokens (auto handled at adapter level)", () => {
      const result = resolver.resolve("test_dex", USDC_NATIVE, USDT, "auto");
      expect(result.tokenIn).toBe(USDC_NATIVE);
      expect(result.tokenOut).toBe(USDT);
      expect(result.resolvedFrom.tokenIn).toBe("original");
      expect(result.resolvedFrom.tokenOut).toBe("original");
    });
  });

  describe("Case insensitivity", () => {
    it("should handle mixed case addresses", () => {
      const upperNative = USDC_NATIVE.toUpperCase();
      expect(resolver.isUSDC(upperNative)).toBe(true);
      
      const alt = resolver.getAlternative(upperNative);
      expect(alt).toBe(USDC_BRIDGED.toLowerCase());
    });
  });
});
