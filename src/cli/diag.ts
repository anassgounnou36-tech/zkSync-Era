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
 * Diagnostic command: test quotes from all DEXes
 * Fetches quotes for configured pairs and displays results
 */
export async function diagQuotes(rpcOverride?: string): Promise<void> {
  logger.info("=== DEX Quote Diagnostics ===");

  // Show selected RPC endpoint
  const rpcUrls = getSelectedRpcUrls(rpcOverride);
  logger.info(`Using RPC: ${rpcUrls.httpUrl}`);

  // Create provider and fetcher
  const provider = createProvider(rpcOverride);
  const fetcher = new PriceFetcher(provider);

  const config = strategyConfig.arbitrage;
  const tokenPairs = config.targetPairs;

  logger.info(`Testing ${tokenPairs.length} token pairs across all enabled DEXes`);
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

    // Use flashloan size from config
    const flashloanSizes = config.flashloanSize as Record<string, string>;
    const amountIn = BigInt(flashloanSizes[pair.tokenA] || "1000000000000000000");

    logger.info(`  Amount In: ${amountIn.toString()} (${pair.tokenA})`);
    logger.info(`  Token A: ${tokenA}`);
    logger.info(`  Token B: ${tokenB}`);

    // Fetch prices from all DEXes
    const prices = await fetcher.fetchAllPrices(tokenA, tokenB, amountIn);

    logger.info(`  DEX Quotes (${pair.tokenA} → ${pair.tokenB}):`);
    for (const price of prices) {
      if (price.success) {
        logger.info(
          `    ✓ ${price.dex}: ${price.amountOut.toString()} ${pair.tokenB} (rate: ${price.price.toFixed(6)})`
        );
      } else {
        logger.info(`    ✗ ${price.dex}: ${price.error}`);
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
  for (const [name, dex] of Object.entries(config.dexes)) {
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
