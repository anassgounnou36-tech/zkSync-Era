import { JsonRpcProvider, Contract, solidityPacked } from "ethers";
import { logger } from "../config/logger.js";
import dexesConfig from "../../config/dexes.json" assert { type: "json" };

const MUTE_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path, bool[] calldata stable) external view returns (uint256[] memory amounts)",
];

const SYNCSWAP_POOL_MASTER_ABI = [
  "function getPool(address tokenA, address tokenB) external view returns (address pool)",
];

const SYNCSWAP_ROUTER_ABI = [
  "function getAmountOut(uint256 amountIn, address tokenIn, address tokenOut) external view returns (uint256 amountOut)",
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

  constructor(provider?: JsonRpcProvider) {
    // Accept a provider instance, or create a fallback (for backward compatibility)
    if (provider) {
      this.provider = provider;
    } else {
      // Fallback for backward compatibility - not recommended
      this.provider = new JsonRpcProvider(dexesConfig.zkSyncEra.rpcUrl);
    }
    this.config = dexesConfig.zkSyncEra;
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
   * Fetch price from SyncSwap V1 using PoolMaster->getPool + Router->getAmountOut
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
      // Get pool address from PoolMaster
      const poolMaster = new Contract(
        this.config.dexes.syncswap_v1.poolMaster,
        SYNCSWAP_POOL_MASTER_ABI,
        this.provider
      );

      const poolAddress = await poolMaster.getPool(tokenIn, tokenOut);

      // Check if pool exists
      if (!poolAddress || poolAddress === "0x0000000000000000000000000000000000000000") {
        logger.debug(
          { dex: "syncswap_v1", tokenIn, tokenOut },
          "Price quote failed - pool not found"
        );

        return {
          dex: "syncswap_v1",
          tokenIn,
          tokenOut,
          amountIn,
          amountOut: 0n,
          price: 0,
          success: false,
          error: "Pool not found",
        };
      }

      // Get quote from router
      const router = new Contract(
        this.config.dexes.syncswap_v1.router,
        SYNCSWAP_ROUTER_ABI,
        this.provider
      );

      const amountOut = await router.getAmountOut(amountIn, tokenIn, tokenOut);

      logger.debug(
        { dex: "syncswap_v1", tokenIn, tokenOut, amountIn: amountIn.toString(), amountOut: amountOut.toString() },
        "Price quote successful"
      );

      return {
        dex: "syncswap_v1",
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
        { dex: "syncswap_v1", tokenIn, tokenOut, error: errorMessage },
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
        error: errorMessage,
      };
    }
  }

  /**
   * Fetch price from PancakeSwap V3 using Quoter V2
   * Tries both single-hop and multi-hop routes (via USDC) to find the best quote
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

    const fee = 2500; // 0.25% fee tier
    const sqrtPriceLimitX96 = 0; // No limit

    // Try single-hop first
    let bestAmountOut = 0n;
    let bestPath = "direct";
    let bestError: string | undefined;

    try {
      const params = {
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        sqrtPriceLimitX96,
      };

      const result = await quoter.quoteExactInputSingle.staticCall(params);
      bestAmountOut = BigInt(result[0].toString());
      
      logger.debug(
        { 
          dex: "pancakeswap_v3", 
          path: "single-hop",
          tokenIn, 
          tokenOut, 
          amountIn: amountIn.toString(), 
          amountOut: bestAmountOut.toString(),
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
          error: errorMessage
        },
        "Single-hop quote failed"
      );
      bestError = errorMessage;
    }

    // Try multi-hop via USDC if single-hop failed or returned small amount
    const usdcAddress = this.config.tokens.USDC.address;
    const tokenInLower = tokenIn.toLowerCase();
    const tokenOutLower = tokenOut.toLowerCase();
    const usdcLower = usdcAddress.toLowerCase();

    // Only try multi-hop if neither token is USDC and tokens are different
    if (tokenInLower !== usdcLower && tokenOutLower !== usdcLower && tokenInLower !== tokenOutLower) {
      try {
        // Build path: tokenIn -> USDC -> tokenOut with fee 2500 for both hops
        const path = this.encodePancakeV3Path(
          [tokenIn, usdcAddress, tokenOut],
          [fee, fee]
        );

        logger.debug(
          { 
            dex: "pancakeswap_v3", 
            path: "multi-hop",
            route: `${tokenIn} -> USDC -> ${tokenOut}`,
            encodedPath: path
          },
          "Trying multi-hop quote"
        );

        const result = await quoter.quoteExactInput.staticCall(path, amountIn);
        const multiHopAmountOut = BigInt(result[0].toString());

        logger.debug(
          { 
            dex: "pancakeswap_v3", 
            path: "multi-hop",
            tokenIn, 
            tokenOut, 
            amountIn: amountIn.toString(), 
            amountOut: multiHopAmountOut.toString(),
            fees: [fee, fee]
          },
          "Multi-hop quote successful"
        );

        // Use multi-hop if it's better than single-hop
        if (multiHopAmountOut > bestAmountOut) {
          bestAmountOut = multiHopAmountOut;
          bestPath = `multi-hop via USDC`;
          bestError = undefined; // Clear error since we got a successful quote
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logger.debug(
          { 
            dex: "pancakeswap_v3", 
            path: "multi-hop",
            tokenIn, 
            tokenOut,
            error: errorMessage
          },
          "Multi-hop quote failed"
        );
        // Don't update bestError if we already have a successful single-hop
        if (bestAmountOut === 0n) {
          bestError = errorMessage;
        }
      }
    }

    // Return the best result
    if (bestAmountOut > 0n) {
      logger.debug(
        { 
          dex: "pancakeswap_v3", 
          selectedPath: bestPath,
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

    return prices;
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
   * Get DEX info from config
   */
  getDexInfo(name: string) {
    return this.config.dexes[name as keyof typeof this.config.dexes];
  }
}
