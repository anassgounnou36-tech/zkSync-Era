import { JsonRpcProvider } from "ethers";
import { logger } from "../config/logger.js";
import { PriceFetcher } from "../prices/fetcher.js";
import dexesConfig from "../../config/dexes.json" assert { type: "json" };

/**
 * Token metadata for USD conversion
 */
export interface TokenMeta {
  address: string;
  symbol: string;
  decimals: number;
}

/**
 * Cached USD price entry
 */
interface UsdPriceCache {
  priceUsdc: bigint; // Amount of USDC (6 decimals) per 1 token
  timestamp: number;
}

/**
 * USD Conversion Manager
 * Uses USDC as $1.00 anchor and fetches small-size reference quotes
 * to convert any token amount to USD value
 */
export class UsdConverter {
  private provider: JsonRpcProvider;
  private fetcher: PriceFetcher;
  private cache: Map<string, UsdPriceCache> = new Map();
  private readonly CACHE_TTL_MS = 5000; // 5 seconds
  private readonly REFERENCE_AMOUNT_WEI = 1n * 10n ** 17n; // 0.1 ETH for WETH
  private readonly REFERENCE_AMOUNT_USDC = 100n * 10n ** 6n; // 100 USDC for stables
  private tokenMeta: Map<string, TokenMeta>;

  constructor(provider: JsonRpcProvider, fetcher: PriceFetcher) {
    this.provider = provider;
    this.fetcher = fetcher;
    this.tokenMeta = this.initializeTokenMeta();
  }

  /**
   * Initialize token metadata from config
   */
  private initializeTokenMeta(): Map<string, TokenMeta> {
    const meta = new Map<string, TokenMeta>();
    
    for (const [symbol, tokenInfo] of Object.entries(dexesConfig.zkSyncEra.tokens)) {
      meta.set(tokenInfo.address.toLowerCase(), {
        address: tokenInfo.address,
        symbol,
        decimals: tokenInfo.decimals,
      });
      
      // Also index by symbol for convenience
      meta.set(symbol, {
        address: tokenInfo.address,
        symbol,
        decimals: tokenInfo.decimals,
      });
    }
    
    return meta;
  }

  /**
   * Get token metadata by address or symbol
   */
  getTokenMeta(addressOrSymbol: string): TokenMeta | undefined {
    return this.tokenMeta.get(addressOrSymbol.toLowerCase()) || 
           this.tokenMeta.get(addressOrSymbol);
  }

  /**
   * Get USD price for a token in USDC (6 decimals)
   * Returns amount of USDC per 1 unit of token
   * Uses cache with 5s TTL
   */
  private async getTokenPriceUsdc(tokenAddress: string): Promise<bigint> {
    const tokenAddressLower = tokenAddress.toLowerCase();
    const usdcAddress = dexesConfig.zkSyncEra.tokens.USDC.address.toLowerCase();
    
    // USDC is always $1.00
    if (tokenAddressLower === usdcAddress) {
      return 10n ** 6n; // 1 USDC = 1 USD (6 decimals)
    }

    // Check cache
    const cached = this.cache.get(tokenAddressLower);
    const now = Date.now();
    
    if (cached && now - cached.timestamp < this.CACHE_TTL_MS) {
      logger.debug(
        { token: tokenAddress, cacheAge: now - cached.timestamp },
        "Using cached USD price"
      );
      return cached.priceUsdc;
    }

    // Fetch fresh price
    const tokenMeta = this.getTokenMeta(tokenAddress);
    if (!tokenMeta) {
      logger.warn({ token: tokenAddress }, "Token metadata not found");
      return 0n;
    }

    // Determine reference amount based on token
    let referenceAmount: bigint;
    if (tokenMeta.symbol === "WETH") {
      referenceAmount = this.REFERENCE_AMOUNT_WEI;
    } else {
      referenceAmount = this.REFERENCE_AMOUNT_USDC;
    }

    logger.debug(
      { 
        token: tokenMeta.symbol, 
        address: tokenAddress,
        referenceAmount: referenceAmount.toString()
      },
      "Fetching USD price via reference quote"
    );

    // Try to get quote token -> USDC
    // Prefer PancakeSwap, fallback to Mute
    let bestQuote: bigint = 0n;
    
    // Try PancakeSwap V3 first
    try {
      const pancakeQuote = await this.fetcher.fetchPancakeSwapV3Price(
        tokenAddress,
        dexesConfig.zkSyncEra.tokens.USDC.address,
        referenceAmount
      );
      
      if (pancakeQuote.success && pancakeQuote.amountOut > 0n) {
        bestQuote = pancakeQuote.amountOut;
        logger.debug(
          { 
            token: tokenMeta.symbol,
            dex: "pancakeswap_v3",
            amountOut: bestQuote.toString()
          },
          "Got USD price from PancakeSwap"
        );
      }
    } catch (error) {
      logger.debug(
        { token: tokenMeta.symbol, error: error instanceof Error ? error.message : "Unknown" },
        "PancakeSwap USD quote failed"
      );
    }

    // Fallback to Mute
    if (bestQuote === 0n) {
      try {
        const muteQuote = await this.fetcher.fetchMutePrice(
          tokenAddress,
          dexesConfig.zkSyncEra.tokens.USDC.address,
          referenceAmount
        );
        
        if (muteQuote.success && muteQuote.amountOut > 0n) {
          bestQuote = muteQuote.amountOut;
          logger.debug(
            { 
              token: tokenMeta.symbol,
              dex: "mute",
              amountOut: bestQuote.toString()
            },
            "Got USD price from Mute"
          );
        }
      } catch (error) {
        logger.debug(
          { token: tokenMeta.symbol, error: error instanceof Error ? error.message : "Unknown" },
          "Mute USD quote failed"
        );
      }
    }

    if (bestQuote === 0n) {
      logger.warn({ token: tokenMeta.symbol }, "Failed to get USD price from any DEX");
      return 0n;
    }

    // Calculate price per 1 token (normalize to token decimals)
    const oneToken = 10n ** BigInt(tokenMeta.decimals);
    const priceUsdc = (bestQuote * oneToken) / referenceAmount;

    // Cache the result
    this.cache.set(tokenAddressLower, {
      priceUsdc,
      timestamp: now,
    });

    logger.debug(
      { 
        token: tokenMeta.symbol,
        priceUsdc: priceUsdc.toString(),
        priceUsdcFormatted: (Number(priceUsdc) / 1e6).toFixed(6)
      },
      "Cached USD price"
    );

    return priceUsdc;
  }

  /**
   * Convert token amount to USD value (in USDC, 6 decimals)
   * Returns the USD value as a bigint with 6 decimals
   */
  async convertToUsd(tokenAddress: string, amount: bigint): Promise<bigint> {
    const tokenMeta = this.getTokenMeta(tokenAddress);
    if (!tokenMeta) {
      logger.warn({ token: tokenAddress }, "Token metadata not found for USD conversion");
      return 0n;
    }

    const priceUsdc = await this.getTokenPriceUsdc(tokenAddress);
    if (priceUsdc === 0n) {
      return 0n;
    }

    // Calculate USD value: (amount * priceUsdc) / 10^tokenDecimals
    const usdValue = (amount * priceUsdc) / (10n ** BigInt(tokenMeta.decimals));
    
    return usdValue;
  }

  /**
   * Convert token amount to USD as a number (for display)
   * Returns the USD value as a floating point number
   */
  async convertToUsdNumber(tokenAddress: string, amount: bigint): Promise<number> {
    const usdValue = await this.convertToUsd(tokenAddress, amount);
    return Number(usdValue) / 1e6;
  }

  /**
   * Clear the cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: Array<{ token: string; age: number }> } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([token, cached]) => ({
      token,
      age: now - cached.timestamp,
    }));
    
    return {
      size: this.cache.size,
      entries,
    };
  }
}
