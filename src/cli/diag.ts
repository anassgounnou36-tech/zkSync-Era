import { logger } from "../config/logger.js";
import { createProvider, getSelectedRpcUrls } from "../providers/factory.js";
import { metricsTracker } from "../monitoring/metrics.js";
import { PriceFetcher } from "../prices/fetcher.js";
import dexesConfig from "../../config/dexes.json" assert { type: "json" };
import strategyConfig from "../../config/strategy.json" assert { type: "json" };

/**
 * Diagnostic command: health check
 * Tests basic RPC connectivity and displays metrics
 */
export async function diagHealth(rpcOverride?: string): Promise<void> {
  logger.info("=== RPC Health Diagnostics ===");

  // Show selected RPC endpoints
  const rpcUrls = getSelectedRpcUrls(rpcOverride);
  logger.info(`Selected HTTP RPC: ${rpcUrls.httpUrl}`);
  if (rpcUrls.wsUrl) {
    logger.info(`Selected WS RPC: ${rpcUrls.wsUrl}`);
  }

  // Create provider
  const provider = createProvider(rpcOverride);

  try {
    // Test basic RPC calls
    logger.info("Testing RPC connectivity...");

    const network = await provider.getNetwork();
    logger.info(`✓ Network: ${network.name} (Chain ID: ${network.chainId})`);

    const blockNumber = await provider.getBlockNumber();
    logger.info(`✓ Current Block: ${blockNumber}`);

    const feeData = await provider.getFeeData();
    logger.info(`✓ Gas Price: ${feeData.gasPrice?.toString()} wei`);

    // Get metrics summary
    const metrics = metricsTracker.getSummary();
    logger.info("=== RPC Request Metrics ===");
    logger.info(`Total Requests: ${metrics.totalRequests}`);
    logger.info(`Successful: ${metrics.successfulRequests}`);
    logger.info(`Failed: ${metrics.failedRequests}`);
    logger.info(`Average Duration: ${metrics.avgDuration.toFixed(2)}ms`);

    if (Object.keys(metrics.byMethod).length > 0) {
      logger.info("Requests by Method:");
      for (const [method, count] of Object.entries(metrics.byMethod)) {
        logger.info(`  ${method}: ${count}`);
      }
    }

    if (Object.keys(metrics.byEndpoint).length > 0) {
      logger.info("Requests by Endpoint:");
      for (const [endpoint, count] of Object.entries(metrics.byEndpoint)) {
        logger.info(`  ${endpoint}: ${count}`);
      }
    }

    logger.info("=== Health Check Complete ===");
    logger.info("✓ All RPC calls successful");
    logger.info(`Check your RPC dashboard for ${rpcUrls.httpUrl}`);
  } catch (error) {
    logger.error({ error }, "Health check failed");
    throw error;
  }
}

/**
 * Format token amount to human-readable string using decimals
 */
function formatTokenAmount(amount: bigint, decimals: number, symbol: string): string {
  const divisor = BigInt(10 ** decimals);
  const wholePart = amount / divisor;
  const fractionalPart = amount % divisor;
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  
  // Show up to 6 decimal places for readability
  const displayDecimals = Math.min(6, decimals);
  const truncatedFractional = fractionalStr.slice(0, displayDecimals);
  
  return `${wholePart}.${truncatedFractional} ${symbol}`;
}

/**
 * Calculate and format spread percentage between two prices
 */
function formatSpread(price1: number, price2: number): string {
  if (price1 === 0 || price2 === 0) return "N/A";
  
  const spread = Math.abs(price1 - price2);
  const spreadPercent = (spread / Math.min(price1, price2)) * 100;
  
  return `${spreadPercent.toFixed(4)}%`;
}

/**
 * Diagnostic command: test quotes from all DEXes
 * Fetches quotes for configured pairs and displays results
 */
export async function diagQuotes(
  rpcOverride?: string, 
  amountOverride?: string,
  dexFilter?: string,
  pairFilter?: string,
  syncswapVerbose?: boolean
): Promise<void> {
  logger.info("=== DEX Quote Diagnostics ===");

  // Show selected RPC endpoint
  const rpcUrls = getSelectedRpcUrls(rpcOverride);
  logger.info(`Using RPC: ${rpcUrls.httpUrl}`);

  // Create provider and fetcher
  const provider = createProvider(rpcOverride);
  const fetcher = new PriceFetcher(provider, { verbose: syncswapVerbose || false });

  const config = strategyConfig.arbitrage;
  let tokenPairs = config.targetPairs;

  // Filter by pair if specified
  if (pairFilter) {
    const [tokenA, tokenB] = pairFilter.split('/');
    tokenPairs = tokenPairs.filter(
      pair => (pair.tokenA === tokenA && pair.tokenB === tokenB) ||
              (pair.tokenA === tokenB && pair.tokenB === tokenA)
    );
    if (tokenPairs.length === 0) {
      logger.warn(`No matching pair found for: ${pairFilter}`);
      return;
    }
  }

  logger.info(`Testing ${tokenPairs.length} token pairs across all enabled DEXes`);
  if (dexFilter) {
    logger.info(`Filtering for DEX: ${dexFilter}`);
  }
  if (syncswapVerbose) {
    logger.info(`SyncSwap verbose mode: enabled`);
  }
  logger.info("=====================================");

  for (const pair of tokenPairs) {
    logger.info(`\nPair: ${pair.tokenA} / ${pair.tokenB}`);

    const tokenAInfo = fetcher.getTokenInfo(pair.tokenA);
    const tokenBInfo = fetcher.getTokenInfo(pair.tokenB);

    if (!tokenAInfo || !tokenBInfo) {
      logger.warn(`  ✗ Token info not found for ${pair.tokenA} or ${pair.tokenB}`);
      continue;
    }

    const tokenA = tokenAInfo.address;
    const tokenB = tokenBInfo.address;

    // Use amount override or flashloan size from config
    let amountIn: bigint;
    if (amountOverride) {
      amountIn = BigInt(amountOverride);
    } else {
      const flashloanSizes = config.flashloanSize as Record<string, string>;
      amountIn = BigInt(flashloanSizes[pair.tokenA] || "1000000000000000000");
    }

    const formattedAmountIn = formatTokenAmount(amountIn, tokenAInfo.decimals, pair.tokenA);
    logger.info(`  Amount In: ${formattedAmountIn}`);
    logger.info(`  Token A: ${tokenA}`);
    logger.info(`  Token B: ${tokenB}`);

    // Fetch prices from all DEXes
    const prices = await fetcher.fetchAllPrices(tokenA, tokenB, amountIn);

    // Filter by DEX if specified
    const filteredPrices = dexFilter 
      ? prices.filter(p => p.dex.toLowerCase() === dexFilter.toLowerCase())
      : prices;

    logger.info(`  DEX Quotes (${pair.tokenA} → ${pair.tokenB}):`);
    for (const price of filteredPrices) {
      if (price.success) {
        const formattedAmountOut = formatTokenAmount(
          price.amountOut, 
          tokenBInfo.decimals, 
          pair.tokenB
        );
        
        // Calculate rate with proper decimals adjustment for human readability
        // Use string conversion to avoid precision loss with very large numbers
        // rate = amountOut (with tokenB decimals) per 1 amountIn (with tokenA decimals)
        const amountOutStr = price.amountOut.toString();
        const amountInStr = price.amountIn.toString();
        
        // Calculate using floating point only after decimal adjustment
        const rateNumerator = parseFloat(amountOutStr) / (10 ** tokenBInfo.decimals);
        const rateDenominator = parseFloat(amountInStr) / (10 ** tokenAInfo.decimals);
        const rate = rateNumerator / rateDenominator;
        
        let metadataStr = "";
        if (price.metadata) {
          const parts: string[] = [];
          if (price.metadata.poolType) parts.push(`pool: ${price.metadata.poolType}`);
          if (price.metadata.method) parts.push(`method: ${price.metadata.method}`);
          if (price.metadata.pathType) parts.push(`path: ${price.metadata.pathType}`);
          if (price.metadata.feeTiers && price.metadata.feeTiers.length > 0) {
            parts.push(`fees: ${price.metadata.feeTiers.join(',')}`);
          }
          if (price.metadata.poolAddress && !price.metadata.pathType) {
            parts.push(`addr: ${price.metadata.poolAddress.slice(0, 10)}...`);
          }
          // Show resolved tokens if aliasing was used
          if (price.metadata.resolvedTokens) {
            const resolved = price.metadata.resolvedTokens;
            if (resolved.tokenInFrom !== "original" || resolved.tokenOutFrom !== "original") {
              const tokenInInfo = resolved.tokenInFrom === "bridged" ? "USDC.e" : 
                                  resolved.tokenInFrom === "native" ? "USDC" : "";
              const tokenOutInfo = resolved.tokenOutFrom === "bridged" ? "USDC.e" : 
                                   resolved.tokenOutFrom === "native" ? "USDC" : "";
              if (tokenInInfo || tokenOutInfo) {
                parts.push(`tokens: ${tokenInInfo || pair.tokenA}/${tokenOutInfo || pair.tokenB}`);
              }
            }
          }
          if (parts.length > 0) {
            metadataStr = ` [${parts.join(', ')}]`;
          }
        }
        
        logger.info(
          `    ✓ ${price.dex.padEnd(15)}: ${formattedAmountOut.padEnd(25)} (${rate.toFixed(6)} ${pair.tokenB} per ${pair.tokenA})${metadataStr}`
        );
      } else {
        logger.info(`    ✗ ${price.dex.padEnd(15)}: ${price.error}`);
      }
    }

    // Calculate and show spreads between successful quotes
    const successfulPrices = filteredPrices.filter(p => p.success);
    if (successfulPrices.length >= 2) {
      logger.info(`  Price Spreads:`);
      for (let i = 0; i < successfulPrices.length; i++) {
        for (let j = i + 1; j < successfulPrices.length; j++) {
          const spread = formatSpread(successfulPrices[i].price, successfulPrices[j].price);
          logger.info(
            `    ${successfulPrices[i].dex} vs ${successfulPrices[j].dex}: ${spread}`
          );
        }
      }
    }
  }

  // Show final metrics
  const metrics = metricsTracker.getSummary();
  logger.info("\n=== Quote Test Complete ===");
  logger.info(`Total RPC Requests: ${metrics.totalRequests}`);
  logger.info(`Successful: ${metrics.successfulRequests}`);
  logger.info(`Failed: ${metrics.failedRequests}`);
  logger.info(`Check your RPC dashboard at ${rpcUrls.httpUrl}`);
}

/**
 * Display DEX configuration
 */
export function diagConfig(): void {
  logger.info("=== DEX Configuration ===");

  const config = dexesConfig.zkSyncEra;
  logger.info(`Chain ID: ${config.chainId}`);
  logger.info(`Default RPC URL: ${config.rpcUrl}`);
  logger.info(`Default WS URL: ${config.wsUrl}`);

  logger.info("\nEnabled DEXes:");
  for (const [, dex] of Object.entries(config.dexes)) {
    if (dex.enabled) {
      logger.info(`  ✓ ${dex.name}`);
      const router = 'router' in dex ? dex.router : ('smartRouter' in dex ? dex.smartRouter : "N/A");
      logger.info(`    Router: ${router}`);
      logger.info(`    Fee: ${dex.fee * 100}%`);
    }
  }

  logger.info("\nConfigured Tokens:");
  for (const [symbol, token] of Object.entries(config.tokens)) {
    logger.info(`  ${symbol}: ${token.address} (${token.decimals} decimals)`);
  }

  const stratConfig = strategyConfig.arbitrage;
  logger.info("\nTarget Pairs:");
  for (const pair of stratConfig.targetPairs) {
    logger.info(`  ${pair.tokenA} / ${pair.tokenB}`);
  }
}
