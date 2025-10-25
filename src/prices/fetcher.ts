import { JsonRpcProvider, Contract } from "ethers";
import { logger } from "../config/logger.js";
import dexesConfig from "../../config/dexes.json" assert { type: "json" };
import { getSyncSwapQuote } from "./adapters/syncswap.js";
import { getVelocoreQuote } from "./adapters/velocore.js";

const MUTE_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path, bool[] calldata stable) external view returns (uint256[] memory amounts)",
];

const PANCAKE_QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
];

export interface DexPrice {
  dex: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
  price: number;
  success: boolean;
  error?: string;
  metadata?: {
    poolAddress?: string;
    poolType?: string;
    method?: string;
    pathType?: string; // e.g., "direct", "multi-hop via USDC"
    feeTiers?: number[]; // Fee tiers used in the path
  };
}

export interface ArbitragePair {
  buyDex: string;
  sellDex: string;
  tokenIn: string;
  tokenOut: string;
  buyPrice: number;
  sellPrice: number;
  spreadPercent: number;
  profitPotential: bigint;
}

export class PriceFetcher {
  private provider: JsonRpcProvider;
  private config: typeof dexesConfig.zkSyncEra;
  private verbose: boolean;

  constructor(provider?: JsonRpcProvider, options: { verbose?: boolean } = {}) {
    // Accept a provider instance, or create a fallback (for backward compatibility)
    if (provider) {
      this.provider = provider;
    } else {
      // Fallback for backward compatibility - not recommended
      this.provider = new JsonRpcProvider(dexesConfig.zkSyncEra.rpcUrl);
    }
    this.config = dexesConfig.zkSyncEra;
    this.verbose = options.verbose || false;
  }

  /**
   * Detect if a pair is a stable pair (e.g., USDC/USDT)
   */
  private isStablePair(tokenIn: string, tokenOut: string): boolean {
    const stablecoins = [
      this.config.tokens.USDC.address.toLowerCase(),
      this.config.tokens.USDT.address.toLowerCase(),
    ];

    const tokenInLower = tokenIn.toLowerCase();
    const tokenOutLower = tokenOut.toLowerCase();

    return stablecoins.includes(tokenInLower) && stablecoins.includes(tokenOutLower);
  }

  /**
   * Encode multi-hop path for PancakeSwap V3 Quoter
   * Path format: tokenIn + fee + tokenOut [+ fee + nextToken ...]
   * Each fee is uint24 (3 bytes)
   */
  private encodePancakeV3Path(tokens: string[], fees: number[]): string {
    if (tokens.length !== fees.length + 1) {
      throw new Error("Invalid path: tokens length must be fees length + 1");
    }

    let path = "0x";
    for (let i = 0; i < fees.length; i++) {
      // Add token address (20 bytes)
      path += tokens[i].slice(2);
      // Add fee (3 bytes, uint24)
      path += fees[i].toString(16).padStart(6, "0");
    }
    // Add final token
    path += tokens[tokens.length - 1].slice(2);
    
    return path;
  }

  /**
   * Fetch price from Mute.io DEX
   * Automatically detects stable pairs (USDC/USDT) and uses stable=true for those
   */
  async fetchMutePrice(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<DexPrice> {
    const isStable = this.isStablePair(tokenIn, tokenOut);

    logger.debug(
      { dex: "mute", tokenIn, tokenOut, amountIn: amountIn.toString(), isStable },
      "Fetching price quote"
    );

    try {
      const router = new Contract(
        this.config.dexes.mute.router,
        MUTE_ROUTER_ABI,
        this.provider
      );

      const path = [tokenIn, tokenOut];
      const stable = [isStable]; // Use stable pool for stablecoin pairs

      const amounts = await router.getAmountsOut(amountIn, path, stable);
      const amountOut = amounts[1];

      logger.debug(
        { 
          dex: "mute", 
          tokenIn, 
          tokenOut, 
          amountIn: amountIn.toString(), 
          amountOut: amountOut.toString(),
          isStable 
        },
        "Price quote successful"
      );

      return {
        dex: "mute",
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: BigInt(amountOut.toString()),
        price: Number(amountOut) / Number(amountIn),
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.debug(
        { dex: "mute", tokenIn, tokenOut, error: errorMessage, isStable },
        "Price quote failed"
      );

      return {
        dex: "mute",
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: 0n,
        price: 0,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Fetch price from SyncSwap V1 using new resilient quote engine
   */
  async fetchSyncSwapV1Price(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<DexPrice> {
    logger.debug(
      { dex: "syncswap_v1", tokenIn, tokenOut, amountIn: amountIn.toString() },
      "Fetching price quote"
    );

    try {
      // Get token symbols for stable pair detection
      const tokenInSymbol = this.getTokenSymbol(tokenIn);
      const tokenOutSymbol = this.getTokenSymbol(tokenOut);

      const result = await getSyncSwapQuote(
        this.provider,
        tokenIn,
        tokenOut,
        amountIn,
        {
          tokenInSymbol,
          tokenOutSymbol,
          verbose: this.verbose,
        }
      );

      if (result.success) {
        logger.debug(
          {
            dex: "syncswap_v1",
            tokenIn,
            tokenOut,
            amountIn: amountIn.toString(),
            amountOut: result.amountOut.toString(),
            poolAddress: result.poolAddress,
            poolType: result.poolType,
            method: result.method,
          },
          "Price quote successful"
        );

        return {
          dex: "syncswap_v1",
          tokenIn,
          tokenOut,
          amountIn,
          amountOut: result.amountOut,
          price: Number(result.amountOut) / Number(amountIn),
          success: true,
          metadata: {
            poolAddress: result.poolAddress,
            poolType: result.poolType,
            method: result.method,
          },
        };
      } else {
        logger.debug(
          {
            dex: "syncswap_v1",
            tokenIn,
            tokenOut,
            error: result.error,
            disabled: result.disabled,
          },
          "Price quote failed"
        );

        return {
          dex: "syncswap_v1",
          tokenIn,
          tokenOut,
          amountIn,
          amountOut: 0n,
          price: 0,
          success: false,
          error: result.error,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.debug(
        { dex: "syncswap_v1", tokenIn, tokenOut, error: errorMessage },
        "Price quote failed with exception"
      );

      return {
        dex: "syncswap_v1",
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: 0n,
        price: 0,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Fetch price from PancakeSwap V3 using Quoter V2
   * Enumerates and evaluates multiple paths:
   * - Direct (exactInputSingle) with fee tiers: 500 and 2500
   * - Multi-hop via USDC (exactInput path): tokenIn->USDC (500, 2500) -> tokenOut (500, 2500)
   * - Multi-hop via USDT for relevant pairs: tokenIn->USDT (500, 2500) -> tokenOut (500, 2500)
   * 
   * Uses concurrency with per-path timeout to efficiently find the best quote.
   */
  async fetchPancakeSwapV3Price(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<DexPrice> {
    logger.debug(
      { dex: "pancakeswap_v3", tokenIn, tokenOut, amountIn: amountIn.toString() },
      "Fetching price quote from Quoter V2"
    );

    const quoter = new Contract(
      this.config.dexes.pancakeswap_v3.quoter,
      PANCAKE_QUOTER_V2_ABI,
      this.provider
    );

    const feeTiers = [500, 2500]; // 0.05% and 0.25% fee tiers
    const sqrtPriceLimitX96 = 0; // No limit
    const PER_PATH_TIMEOUT_MS = 5000; // 5 second timeout per path

    interface PathAttempt {
      pathType: string;
      feeTiers: number[];
      amountOut: bigint;
      success: boolean;
      error?: string;
    }

    const pathAttempts: PathAttempt[] = [];

    // Helper to try a path with timeout
    const tryPathWithTimeout = async (
      pathFn: () => Promise<bigint>,
      pathType: string,
      fees: number[]
    ): Promise<PathAttempt> => {
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("timeout")), PER_PATH_TIMEOUT_MS);
        });

        const amountOut = await Promise.race([pathFn(), timeoutPromise]);

        logger.debug(
          { 
            dex: "pancakeswap_v3", 
            pathType,
            fees,
            amountOut: amountOut.toString(),
          },
          "Path quote successful"
        );

        return {
          pathType,
          feeTiers: fees,
          amountOut,
          success: true,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        const reason = errorMessage.includes("timeout") 
          ? "timeout"
          : errorMessage.includes("revert") || errorMessage.includes("insufficient")
          ? "revert/insufficient liquidity"
          : "error";

        logger.debug(
          { 
            dex: "pancakeswap_v3", 
            pathType,
            fees,
            error: errorMessage,
            reason
          },
          "Path quote failed"
        );

        return {
          pathType,
          feeTiers: fees,
          amountOut: 0n,
          success: false,
          error: reason,
        };
      }
    };

    const tokenInLower = tokenIn.toLowerCase();
    const tokenOutLower = tokenOut.toLowerCase();

    // Build list of path attempts
    const pathPromises: Promise<PathAttempt>[] = [];

    // 1. Try direct paths with each fee tier
    for (const fee of feeTiers) {
      const pathFn = async () => {
        const params = {
          tokenIn,
          tokenOut,
          amountIn,
          fee,
          sqrtPriceLimitX96,
        };
        const result = await quoter.quoteExactInputSingle.staticCall(params);
        return BigInt(result[0].toString());
      };
      pathPromises.push(tryPathWithTimeout(pathFn, `direct (fee: ${fee})`, [fee]));
    }

    // 2. Try multi-hop via USDC and USDT
    const intermediateTokens = [
      { address: this.config.tokens.USDC.address, symbol: "USDC" },
      { address: this.config.tokens.USDT.address, symbol: "USDT" },
    ];

    for (const intermediate of intermediateTokens) {
      const intermediateLower = intermediate.address.toLowerCase();
      
      // Skip if either token is the intermediate or if tokens are the same
      if (tokenInLower === intermediateLower || 
          tokenOutLower === intermediateLower || 
          tokenInLower === tokenOutLower) {
        continue;
      }

      // Try different fee tier combinations
      for (const fee1 of feeTiers) {
        for (const fee2 of feeTiers) {
          const pathFn = async () => {
            const path = this.encodePancakeV3Path(
              [tokenIn, intermediate.address, tokenOut],
              [fee1, fee2]
            );
            const result = await quoter.quoteExactInput.staticCall(path, amountIn);
            return BigInt(result[0].toString());
          };
          pathPromises.push(
            tryPathWithTimeout(pathFn, `multi-hop via ${intermediate.symbol}`, [fee1, fee2])
          );
        }
      }
    }

    // Execute all paths with small concurrency (up to 3 concurrent requests)
    const CONCURRENCY = 3;
    for (let i = 0; i < pathPromises.length; i += CONCURRENCY) {
      const batch = pathPromises.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch);
      pathAttempts.push(...results);
    }

    // Find the best successful path
    let bestAttempt: PathAttempt | null = null;
    for (const attempt of pathAttempts) {
      if (attempt.success && (!bestAttempt || attempt.amountOut > bestAttempt.amountOut)) {
        bestAttempt = attempt;
      }
    }

    // Generate statistics for logging
    const totalPaths = pathAttempts.length;
    const successfulPaths = pathAttempts.filter(a => a.success).length;
    const failedPaths = pathAttempts.filter(a => !a.success).length;
    const timeoutCount = pathAttempts.filter(a => a.error === "timeout").length;
    const revertCount = pathAttempts.filter(a => a.error === "revert/insufficient liquidity").length;

    // Return the best result
    if (bestAttempt) {
      logger.debug(
        { 
          dex: "pancakeswap_v3", 
          selectedPath: bestAttempt.pathType,
          fees: bestAttempt.feeTiers,
          tokenIn, 
          tokenOut, 
          amountIn: amountIn.toString(), 
          amountOut: bestAttempt.amountOut.toString(),
          pathStats: {
            total: totalPaths,
            successful: successfulPaths,
            failed: failedPaths,
            timeouts: timeoutCount,
            reverts: revertCount
          },
          quoterAddress: this.config.dexes.pancakeswap_v3.quoter
        },
        `Price quote successful using ${bestAttempt.pathType}`
      );

      return {
        dex: "pancakeswap_v3",
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: bestAttempt.amountOut,
        price: Number(bestAttempt.amountOut) / Number(amountIn),
        success: true,
        metadata: {
          poolAddress: bestAttempt.pathType,
          method: bestAttempt.pathType,
          pathType: bestAttempt.pathType,
          feeTiers: bestAttempt.feeTiers,
        },
      };
    } else {
      const firstError = pathAttempts.find(a => a.error)?.error || "Unknown error";
      logger.warn(
        { 
          dex: "pancakeswap_v3", 
          tokenIn, 
          tokenOut, 
          amountIn: amountIn.toString(),
          pathStats: {
            total: totalPaths,
            successful: successfulPaths,
            failed: failedPaths,
            timeouts: timeoutCount,
            reverts: revertCount
          },
          quoterAddress: this.config.dexes.pancakeswap_v3.quoter
        },
        "All quote paths failed - pool may not exist or have insufficient liquidity"
      );

      return {
        dex: "pancakeswap_v3",
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: 0n,
        price: 0,
        success: false,
        error: firstError,
      };
    }
  }

  /**
   * Fetch prices from all enabled DEXes
   */
  async fetchAllPrices(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<DexPrice[]> {
    const prices: DexPrice[] = [];

    // Fetch from Mute if enabled
    if (this.config.dexes.mute.enabled) {
      const mutePrice = await this.fetchMutePrice(tokenIn, tokenOut, amountIn);
      prices.push(mutePrice);
    }

    // SyncSwap V1 placeholder
    if (this.config.dexes.syncswap_v1.enabled) {
      const syncPrice = await this.fetchSyncSwapV1Price(
        tokenIn,
        tokenOut,
        amountIn
      );
      prices.push(syncPrice);
    }

    // PancakeSwap V3
    if (this.config.dexes.pancakeswap_v3.enabled) {
      const pancakePrice = await this.fetchPancakeSwapV3Price(
        tokenIn,
        tokenOut,
        amountIn
      );
      prices.push(pancakePrice);
    }

    // Velocore (read-only, disabled by default)
    if (this.config.dexes.velocore?.enabled) {
      const velocorePrice = await this.fetchVelocorePrice(
        tokenIn,
        tokenOut,
        amountIn
      );
      prices.push(velocorePrice);
    }

    return prices;
  }

  /**
   * Fetch price from Velocore (read-only, disabled by default)
   * This method must not throw; skip on error
   */
  async fetchVelocorePrice(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<DexPrice> {
    logger.debug(
      { dex: "velocore", tokenIn, tokenOut, amountIn: amountIn.toString() },
      "Fetching price quote"
    );

    try {
      // Velocore requires a pool address - if not configured, skip
      const poolAddress = this.config.dexes.velocore?.pool;
      if (!poolAddress || poolAddress === "0x0000000000000000000000000000000000000000") {
        logger.debug(
          { dex: "velocore" },
          "Pool address not configured, skipping"
        );
        return {
          dex: "velocore",
          tokenIn,
          tokenOut,
          amountIn,
          amountOut: 0n,
          price: 0,
          success: false,
          error: "Pool address not configured",
        };
      }

      const result = await getVelocoreQuote(
        this.provider,
        poolAddress,
        tokenIn,
        tokenOut,
        amountIn,
        { verbose: this.verbose }
      );

      if (result.success) {
        logger.debug(
          {
            dex: "velocore",
            tokenIn,
            tokenOut,
            amountIn: amountIn.toString(),
            amountOut: result.amountOut.toString(),
          },
          "Price quote successful"
        );

        return {
          dex: "velocore",
          tokenIn,
          tokenOut,
          amountIn,
          amountOut: result.amountOut,
          price: Number(result.amountOut) / Number(amountIn),
          success: true,
        };
      } else {
        logger.debug(
          { dex: "velocore", error: result.error },
          "Price quote failed"
        );

        return {
          dex: "velocore",
          tokenIn,
          tokenOut,
          amountIn,
          amountOut: 0n,
          price: 0,
          success: false,
          error: result.error,
        };
      }
    } catch (error) {
      // Must not throw - catch all errors and return failed result
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.debug(
        { dex: "velocore", error: errorMessage },
        "Price quote failed with exception (caught safely)"
      );

      return {
        dex: "velocore",
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: 0n,
        price: 0,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Find best arbitrage opportunity between DEXes
   */
  async findArbitrageOpportunity(
    tokenA: string,
    tokenB: string,
    amount: bigint
  ): Promise<ArbitragePair | null> {
    // Get prices for A -> B on all DEXes
    const pricesAtoB = await this.fetchAllPrices(tokenA, tokenB, amount);

    // Get prices for B -> A on all DEXes
    const pricesBtoA = await this.fetchAllPrices(tokenB, tokenA, amount);

    let bestOpportunity: ArbitragePair | null = null;
    let maxSpread = 0;

    // Find best buy and sell combination
    for (const buyPrice of pricesAtoB) {
      if (!buyPrice.success) continue;

      for (const sellPrice of pricesBtoA) {
        if (!sellPrice.success) continue;

        // Calculate spread: buying tokenB with tokenA, then selling tokenB for tokenA
        const spread = sellPrice.price - 1 / buyPrice.price;
        const spreadPercent = (spread / (1 / buyPrice.price)) * 100;

        if (spreadPercent > maxSpread && spreadPercent > 0.1) {
          maxSpread = spreadPercent;

          // Estimate profit (simplified)
          const intermediateB = buyPrice.amountOut;
          const finalA = (intermediateB * BigInt(Math.floor(sellPrice.price * 1e18))) / BigInt(1e18);
          const profitPotential = finalA > amount ? finalA - amount : 0n;

          bestOpportunity = {
            buyDex: buyPrice.dex,
            sellDex: sellPrice.dex,
            tokenIn: tokenA,
            tokenOut: tokenB,
            buyPrice: buyPrice.price,
            sellPrice: sellPrice.price,
            spreadPercent,
            profitPotential,
          };
        }
      }
    }

    return bestOpportunity;
  }

  /**
   * Get token info from config
   */
  getTokenInfo(symbol: string) {
    return this.config.tokens[symbol as keyof typeof this.config.tokens];
  }

  /**
   * Get token symbol by address
   */
  private getTokenSymbol(address: string): string | undefined {
    const addressLower = address.toLowerCase();
    for (const [symbol, token] of Object.entries(this.config.tokens)) {
      if (token.address.toLowerCase() === addressLower) {
        return symbol;
      }
    }
    return undefined;
  }

  /**
   * Get DEX info from config
   */
  getDexInfo(name: string) {
    return this.config.dexes[name as keyof typeof this.config.dexes];
  }
}
