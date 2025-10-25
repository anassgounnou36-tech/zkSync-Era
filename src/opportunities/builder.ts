import { JsonRpcProvider } from "ethers";
import { logger } from "../config/logger.js";
import { PriceFetcher, DexPrice } from "../prices/fetcher.js";
import { UsdConverter } from "../utils/usdConverter.js";
import { calculateGrossSpreadBps, applySlippage } from "../utils/math.js";
import strategyConfig from "../../config/strategy.json" assert { type: "json" };
import dexesConfig from "../../config/dexes.json" assert { type: "json" };

/**
 * Quote with metadata for opportunity analysis
 */
export interface EnhancedQuote extends DexPrice {
  path?: string;
  fees?: number[];
  timestamp: number;
}

/**
 * Recognized arbitrage opportunity
 */
export interface RecognizedOpportunity {
  // Pair info
  tokenA: string;
  tokenB: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  
  // Direction: A -> B -> A
  amountIn: bigint;
  
  // Best quotes
  quoteAtoB: EnhancedQuote; // Buy B with A
  quoteBtoA: EnhancedQuote; // Sell B for A (buyback)
  
  // Spread calculations
  grossSpreadBps: bigint; // Zero-slippage spread
  slipAdjSpreadBps: bigint; // Slippage-adjusted spread
  
  // USD values
  usdValueIn: bigint; // 6 decimals
  usdValueOut: bigint; // 6 decimals
  
  // Recognition flag
  recognized: boolean; // true if grossSpreadBps > 0
  executable: boolean; // true if meets minProfitUSD and slippage gates
  
  // Gas estimation (for display only)
  estimatedGasCost: bigint;
  netProfitEst: bigint;
  
  // Timestamps
  timestamp: number;
}

/**
 * Exhaustive opportunity builder
 * Fetches quotes from all enabled DEXes and identifies arbitrage opportunities
 */
export class OpportunityBuilder {
  private provider: JsonRpcProvider;
  private fetcher: PriceFetcher;
  private usdConverter: UsdConverter;
  private maxSlippageBps: bigint;

  constructor(provider: JsonRpcProvider, fetcher: PriceFetcher, usdConverter: UsdConverter) {
    this.provider = provider;
    this.fetcher = fetcher;
    this.usdConverter = usdConverter;
    
    // Convert maxSlippage to basis points (0.005 = 50 bps)
    this.maxSlippageBps = BigInt(Math.floor(strategyConfig.arbitrage.maxSlippage * 10000));
  }

  /**
   * Fetch best quote across all enabled DEXes
   */
  private async fetchBestQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<EnhancedQuote | null> {
    const quotes = await this.fetcher.fetchAllPrices(tokenIn, tokenOut, amountIn);
    const timestamp = Date.now();
    
    let bestQuote: EnhancedQuote | null = null;
    let bestAmountOut = 0n;
    
    for (const quote of quotes) {
      if (quote.success && quote.amountOut > bestAmountOut) {
        bestAmountOut = quote.amountOut;
        bestQuote = {
          ...quote,
          path: quote.metadata?.poolAddress || "direct",
          fees: [], // Will be populated by DEX-specific logic
          timestamp,
        };
      }
    }
    
    if (bestQuote) {
      logger.debug(
        {
          dex: bestQuote.dex,
          tokenIn,
          tokenOut,
          amountIn: amountIn.toString(),
          amountOut: bestAmountOut.toString(),
        },
        "Best quote found"
      );
    } else {
      logger.debug(
        { tokenIn, tokenOut },
        "No successful quotes found"
      );
    }
    
    return bestQuote;
  }

  /**
   * Estimate gas cost for an arbitrage opportunity
   * Uses provider.getFeeData() + configurable gas usage per leg
   */
  private async estimateGasCost(legCount: number = 2): Promise<bigint> {
    try {
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || 0n;
      
      // Default gas usage estimates per leg
      const flashloanOverhead = 120000n; // Flashloan setup and callback
      const v3GasPerLeg = 150000n; // PancakeSwap V3 exactInputSingle
      const v2GasPerLeg = 180000n; // Mute/SyncSwap
      
      // Estimate total gas (conservative average)
      const avgGasPerLeg = (v3GasPerLeg + v2GasPerLeg) / 2n;
      const totalGas = flashloanOverhead + (avgGasPerLeg * BigInt(legCount));
      
      return gasPrice * totalGas;
    } catch (error) {
      logger.warn({ error }, "Failed to estimate gas cost");
      return 0n;
    }
  }

  /**
   * Build a recognized opportunity from quotes
   */
  private async buildOpportunity(
    tokenA: string,
    tokenB: string,
    amountIn: bigint,
    quoteAtoB: EnhancedQuote,
    quoteBtoA: EnhancedQuote
  ): Promise<RecognizedOpportunity> {
    const tokenAMeta = this.usdConverter.getTokenMeta(tokenA);
    const tokenBMeta = this.usdConverter.getTokenMeta(tokenB);
    
    if (!tokenAMeta || !tokenBMeta) {
      throw new Error("Token metadata not found");
    }
    
    // Calculate round-trip
    const finalA = quoteBtoA.amountOut;
    
    // Zero-slippage spread
    const grossSpreadBps = calculateGrossSpreadBps(amountIn, finalA);
    
    // Slippage-adjusted spread
    // For the second leg, we need to get a new quote with the slippage-adjusted amount
    // For simplicity, we'll approximate by applying slippage to the final amount
    const finalAWithSlip = applySlippage(finalA, this.maxSlippageBps);
    const slipAdjSpreadBps = calculateGrossSpreadBps(amountIn, finalAWithSlip);
    
    // USD conversion
    const usdValueIn = await this.usdConverter.convertToUsd(tokenA, amountIn);
    const usdValueOut = await this.usdConverter.convertToUsd(tokenA, finalA);
    
    // Gas estimation
    const estimatedGasCost = await this.estimateGasCost(2);
    const estimatedGasCostUsdc = await this.usdConverter.convertToUsd(
      dexesConfig.zkSyncEra.tokens.WETH.address,
      estimatedGasCost
    );
    
    // Net profit estimate (USD value out - USD value in - gas cost)
    const grossProfitUsdc = usdValueOut > usdValueIn ? usdValueOut - usdValueIn : 0n;
    const netProfitEst = grossProfitUsdc > estimatedGasCostUsdc 
      ? grossProfitUsdc - estimatedGasCostUsdc 
      : 0n;
    
    // Recognition and executability
    const recognized = grossSpreadBps > 0n;
    const minProfitUsdc = BigInt(Math.floor(strategyConfig.arbitrage.minProfitUSD * 1e6));
    const executable = recognized && netProfitEst >= minProfitUsdc && slipAdjSpreadBps > 0n;
    
    return {
      tokenA,
      tokenB,
      tokenASymbol: tokenAMeta.symbol,
      tokenBSymbol: tokenBMeta.symbol,
      amountIn,
      quoteAtoB,
      quoteBtoA,
      grossSpreadBps,
      slipAdjSpreadBps,
      usdValueIn,
      usdValueOut,
      recognized,
      executable,
      estimatedGasCost,
      netProfitEst,
      timestamp: Date.now(),
    };
  }

  /**
   * Scan for opportunities across all configured pairs and sizes
   */
  async scanOpportunities(options: {
    pairs?: Array<{ tokenA: string; tokenB: string }>;
    sizes?: Record<string, bigint>;
    minSpreadBps?: bigint;
  } = {}): Promise<RecognizedOpportunity[]> {
    const opportunities: RecognizedOpportunity[] = [];
    
    // Use configured pairs or provided pairs
    const pairs = options.pairs || strategyConfig.arbitrage.targetPairs.map(pair => {
      const tokenAInfo = this.fetcher.getTokenInfo(pair.tokenA);
      const tokenBInfo = this.fetcher.getTokenInfo(pair.tokenB);
      return {
        tokenA: tokenAInfo!.address,
        tokenB: tokenBInfo!.address,
      };
    });
    
    // Use configured sizes or provided sizes
    const sizes = options.sizes || Object.fromEntries(
      Object.entries(strategyConfig.arbitrage.flashloanSize).map(([symbol, size]) => {
        const tokenInfo = this.fetcher.getTokenInfo(symbol);
        return [tokenInfo!.address.toLowerCase(), BigInt(size as string)];
      })
    );
    
    logger.info(
      { pairCount: pairs.length, sizeCount: Object.keys(sizes).length },
      "Starting opportunity scan"
    );
    
    for (const pair of pairs) {
      // Determine size for base token (tokenA), with fallback to tokenB
      let size = sizes[pair.tokenA.toLowerCase()];
      let sizeSource = "tokenA";
      
      if (!size) {
        size = sizes[pair.tokenB.toLowerCase()];
        sizeSource = "tokenB (fallback)";
      }
      
      if (!size) {
        // Try getting from configured defaults
        const tokenASymbol = this.getTokenSymbol(pair.tokenA);
        const tokenBSymbol = this.getTokenSymbol(pair.tokenB);
        
        if (tokenASymbol && strategyConfig.arbitrage.flashloanSize[tokenASymbol as keyof typeof strategyConfig.arbitrage.flashloanSize]) {
          size = BigInt(strategyConfig.arbitrage.flashloanSize[tokenASymbol as keyof typeof strategyConfig.arbitrage.flashloanSize] as string);
          sizeSource = "config default for tokenA";
        } else if (tokenBSymbol && strategyConfig.arbitrage.flashloanSize[tokenBSymbol as keyof typeof strategyConfig.arbitrage.flashloanSize]) {
          size = BigInt(strategyConfig.arbitrage.flashloanSize[tokenBSymbol as keyof typeof strategyConfig.arbitrage.flashloanSize] as string);
          sizeSource = "config default for tokenB";
        }
      }
      
      if (!size) {
        logger.warn({ pair }, "No size configured for pair, skipping");
        continue;
      }
      
      const tokenASymbol = this.getTokenSymbol(pair.tokenA);
      const tokenBSymbol = this.getTokenSymbol(pair.tokenB);
      
      if (sizeSource.includes("fallback") || sizeSource.includes("config default")) {
        logger.warn(
          { 
            pair: `${tokenASymbol}/${tokenBSymbol}`, 
            size: size.toString(),
            sizeSource
          }, 
          `Using ${sizeSource} size for pair`
        );
      } else {
        logger.debug({ pair, size: size.toString(), sizeSource }, "Scanning pair");
      }
      
      // Fetch best quotes in both directions
      const quoteAtoB = await this.fetchBestQuote(pair.tokenA, pair.tokenB, size);
      if (!quoteAtoB) {
        logger.debug({ pair }, "No quote A->B, skipping");
        continue;
      }
      
      // For the return leg, use the output from first leg
      const quoteBtoA = await this.fetchBestQuote(pair.tokenB, pair.tokenA, quoteAtoB.amountOut);
      if (!quoteBtoA) {
        logger.debug({ pair }, "No quote B->A, skipping");
        continue;
      }
      
      // Build opportunity
      const opportunity = await this.buildOpportunity(
        pair.tokenA,
        pair.tokenB,
        size,
        quoteAtoB,
        quoteBtoA
      );
      
      // Filter by minimum spread if specified
      const minSpread = options.minSpreadBps || 0n;
      if (opportunity.grossSpreadBps >= minSpread) {
        opportunities.push(opportunity);
        
        logger.info(
          {
            pair: `${opportunity.tokenASymbol}/${opportunity.tokenBSymbol}`,
            dexA: quoteAtoB.dex,
            dexB: quoteBtoA.dex,
            grossSpreadBps: opportunity.grossSpreadBps.toString(),
            recognized: opportunity.recognized,
            executable: opportunity.executable,
            netProfitUsd: (Number(opportunity.netProfitEst) / 1e6).toFixed(2),
          },
          "Opportunity found"
        );
      }
    }
    
    logger.info(
      { count: opportunities.length },
      "Opportunity scan complete"
    );
    
    return opportunities;
  }

  /**
   * Get a single opportunity for a specific pair and size
   */
  async getOpportunity(
    tokenA: string,
    tokenB: string,
    amountIn: bigint
  ): Promise<RecognizedOpportunity | null> {
    const quoteAtoB = await this.fetchBestQuote(tokenA, tokenB, amountIn);
    if (!quoteAtoB) {
      return null;
    }
    
    const quoteBtoA = await this.fetchBestQuote(tokenB, tokenA, quoteAtoB.amountOut);
    if (!quoteBtoA) {
      return null;
    }
    
    return this.buildOpportunity(tokenA, tokenB, amountIn, quoteAtoB, quoteBtoA);
  }

  /**
   * Get token symbol by address
   */
  private getTokenSymbol(address: string): string | undefined {
    const addressLower = address.toLowerCase();
    for (const [symbol, token] of Object.entries(dexesConfig.zkSyncEra.tokens)) {
      if (token.address.toLowerCase() === addressLower) {
        return symbol;
      }
    }
    return undefined;
  }
}
