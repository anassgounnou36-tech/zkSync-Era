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
   * Tries multiple fee tiers and multi-hop routes (via WETH, USDC, USDT) to find the best quote
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

    let bestAmountOut = 0n;
    let bestPath = "direct";
    let bestFees: number[] = [];
    let bestError: string | undefined;

    // Try single-hop with multiple fee tiers
    for (const fee of feeTiers) {
      try {
        const params = {
          tokenIn,
          tokenOut,
          amountIn,
          fee,
          sqrtPriceLimitX96,
        };

        const result = await quoter.quoteExactInputSingle.staticCall(params);
        const amountOut = BigInt(result[0].toString());
        
        if (amountOut > bestAmountOut) {
          bestAmountOut = amountOut;
          bestPath = `direct (fee: ${fee})`;
          bestFees = [fee];
          bestError = undefined;
        }
        
        logger.debug(
          { 
            dex: "pancakeswap_v3", 
            path: "single-hop",
            tokenIn, 
            tokenOut, 
            amountIn: amountIn.toString(), 
            amountOut: amountOut.toString(),
            fee
          },
          "Single-hop quote successful"
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.debug(
          { 
            dex: "pancakeswap_v3", 
            path: "single-hop",
            tokenIn, 
            tokenOut,
            fee,
            error: errorMessage
          },
          "Single-hop quote failed"
        );
        if (bestAmountOut === 0n) {
          bestError = errorMessage;
        }
      }
    }

    // Try multi-hop via WETH, USDC, and USDT
    const intermediateTokens = [
      { address: this.config.tokens.WETH.address, symbol: "WETH" },
      { address: this.config.tokens.USDC.address, symbol: "USDC" },
      { address: this.config.tokens.USDT.address, symbol: "USDT" },
    ];

    const tokenInLower = tokenIn.toLowerCase();
    const tokenOutLower = tokenOut.toLowerCase();

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
          try {
            const path = this.encodePancakeV3Path(
              [tokenIn, intermediate.address, tokenOut],
              [fee1, fee2]
            );

            logger.debug(
              { 
                dex: "pancakeswap_v3", 
                path: "multi-hop",
                route: `${tokenIn} -> ${intermediate.symbol} -> ${tokenOut}`,
                fees: [fee1, fee2]
              },
              "Trying multi-hop quote"
            );

            const result = await quoter.quoteExactInput.staticCall(path, amountIn);
            const amountOut = BigInt(result[0].toString());

            if (amountOut > bestAmountOut) {
              bestAmountOut = amountOut;
              bestPath = `multi-hop via ${intermediate.symbol}`;
              bestFees = [fee1, fee2];
              bestError = undefined;
            }

            logger.debug(
              { 
                dex: "pancakeswap_v3", 
                path: "multi-hop",
                intermediate: intermediate.symbol,
                amountOut: amountOut.toString(),
                fees: [fee1, fee2]
              },
              "Multi-hop quote successful"
            );
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logger.debug(
              { 
                dex: "pancakeswap_v3", 
                path: "multi-hop",
                intermediate: intermediate.symbol,
                fees: [fee1, fee2],
                error: errorMessage
              },
              "Multi-hop quote failed"
            );
          }
        }
      }
    }

    // Return the best result
    if (bestAmountOut > 0n) {
      logger.debug(
        { 
          dex: "pancakeswap_v3", 
          selectedPath: bestPath,
          fees: bestFees,
          tokenIn, 
          tokenOut, 
          amountIn: amountIn.toString(), 
          amountOut: bestAmountOut.toString(),
          quoterAddress: this.config.dexes.pancakeswap_v3.quoter
        },
        `Price quote successful using ${bestPath}`
      );

      return {
        dex: "pancakeswap_v3",
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: bestAmountOut,
        price: Number(bestAmountOut) / Number(amountIn),
        success: true,
        metadata: {
          poolAddress: bestPath,
          method: bestPath,
        },
      };
    } else {
      logger.warn(
        { 
          dex: "pancakeswap_v3", 
          tokenIn, 
          tokenOut, 
          amountIn: amountIn.toString(),
          error: bestError,
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
        error: bestError,
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
