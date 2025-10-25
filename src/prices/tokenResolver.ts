/**
 * DEXTokenResolver - Handles DEX-scoped token aliasing
 * 
 * Primary use case: Native USDC (0x1d17...) vs Bridged USDC.e (0x3355...)
 * 
 * Each DEX adapter can configure:
 * - auto: Try native USDC first, fall back to USDC.e if no pool exists
 * - force-native: Always use native USDC (fail if pool doesn't exist)
 * - force-bridged: Always use bridged USDC.e
 * - off: No aliasing, use addresses as-is
 */

import dexesConfig from "../../config/dexes.json" assert { type: "json" };

export type AliasingPolicy = "auto" | "force-native" | "force-bridged" | "off";

export interface TokenAlias {
  native: string;   // Native USDC address
  bridged: string;  // Bridged USDC.e address
}

export interface TokenResolution {
  tokenIn: string;
  tokenOut: string;
  resolvedFrom: {
    tokenIn: "native" | "bridged" | "original";
    tokenOut: "native" | "bridged" | "original";
  };
}

/**
 * DEX-scoped token resolver
 */
export class DEXTokenResolver {
  private readonly usdcNative: string;
  private readonly usdcBridged: string;

  constructor() {
    this.usdcNative = dexesConfig.zkSyncEra.tokens.USDC.address.toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.usdcBridged = (dexesConfig.zkSyncEra.tokens as any)["USDC.e"].address.toLowerCase();
  }

  /**
   * Resolve token addresses based on DEX policy
   * Returns the token addresses to use for quoting
   */
  resolve(
    dex: string,
    tokenIn: string,
    tokenOut: string,
    policy: AliasingPolicy = "auto"
  ): TokenResolution {
    if (policy === "off") {
      return {
        tokenIn,
        tokenOut,
        resolvedFrom: { tokenIn: "original", tokenOut: "original" },
      };
    }

    const tokenInLower = tokenIn.toLowerCase();
    const tokenOutLower = tokenOut.toLowerCase();

    let resolvedTokenIn = tokenIn;
    let resolvedTokenOut = tokenOut;
    let resolvedFromIn: "native" | "bridged" | "original" = "original";
    let resolvedFromOut: "native" | "bridged" | "original" = "original";

    // Apply aliasing policy
    if (policy === "force-native") {
      // Replace bridged USDC with native USDC
      if (tokenInLower === this.usdcBridged) {
        resolvedTokenIn = this.usdcNative;
        resolvedFromIn = "native";
      }
      if (tokenOutLower === this.usdcBridged) {
        resolvedTokenOut = this.usdcNative;
        resolvedFromOut = "native";
      }
    } else if (policy === "force-bridged") {
      // Replace native USDC with bridged USDC
      if (tokenInLower === this.usdcNative) {
        resolvedTokenIn = this.usdcBridged;
        resolvedFromIn = "bridged";
      }
      if (tokenOutLower === this.usdcNative) {
        resolvedTokenOut = this.usdcBridged;
        resolvedFromOut = "bridged";
      }
    }
    // "auto" policy is handled at the DEX adapter level by trying both

    return {
      tokenIn: resolvedTokenIn,
      tokenOut: resolvedTokenOut,
      resolvedFrom: {
        tokenIn: resolvedFromIn,
        tokenOut: resolvedFromOut,
      },
    };
  }

  /**
   * Get alternative token addresses for auto-fallback
   * Returns null if token is not USDC (native or bridged)
   */
  getAlternative(token: string): string | null {
    const tokenLower = token.toLowerCase();
    
    if (tokenLower === this.usdcNative) {
      return this.usdcBridged;
    } else if (tokenLower === this.usdcBridged) {
      return this.usdcNative;
    }
    
    return null;
  }

  /**
   * Check if a token is USDC (native or bridged)
   */
  isUSDC(token: string): boolean {
    const tokenLower = token.toLowerCase();
    return tokenLower === this.usdcNative || tokenLower === this.usdcBridged;
  }

  /**
   * Get token symbol for logging
   */
  getTokenSymbol(token: string): string {
    const tokenLower = token.toLowerCase();
    
    if (tokenLower === this.usdcNative) {
      return "USDC";
    } else if (tokenLower === this.usdcBridged) {
      return "USDC.e";
    }
    
    // Look up in config
    for (const [symbol, tokenInfo] of Object.entries(dexesConfig.zkSyncEra.tokens)) {
      if (tokenInfo.address.toLowerCase() === tokenLower) {
        return symbol;
      }
    }
    
    return token;
  }

  /**
   * Check if a pair involves USDC aliasing
   */
  pairInvolvesUSDC(tokenIn: string, tokenOut: string): boolean {
    return this.isUSDC(tokenIn) || this.isUSDC(tokenOut);
  }
}
