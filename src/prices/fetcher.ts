import { JsonRpcProvider, Contract } from "ethers";
import dexesConfig from "../../config/dexes.json" assert { type: "json" };

const MUTE_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path, bool[] calldata stable) external view returns (uint256[] memory amounts)",
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

  constructor(rpcUrl?: string) {
    const url = rpcUrl || dexesConfig.zkSyncEra.rpcUrl;
    this.provider = new JsonRpcProvider(url);
    this.config = dexesConfig.zkSyncEra;
  }

  /**
   * Fetch price from Mute.io DEX
   */
  async fetchMutePrice(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<DexPrice> {
    try {
      const router = new Contract(
        this.config.dexes.mute.router,
        MUTE_ROUTER_ABI,
        this.provider
      );

      const path = [tokenIn, tokenOut];
      const stable = [false]; // Use volatile pools

      const amounts = await router.getAmountsOut(amountIn, path, stable);
      const amountOut = amounts[1];

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
      return {
        dex: "mute",
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: 0n,
        price: 0,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Fetch price from SyncSwap V1 (placeholder - not fully implemented)
   */
  async fetchSyncSwapV1Price(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<DexPrice> {
    // SyncSwap V1 requires pool-specific logic which is deferred
    return {
      dex: "syncswap_v1",
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: 0n,
      price: 0,
      success: false,
      error: "SyncSwap V1 price fetching not yet implemented",
    };
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
