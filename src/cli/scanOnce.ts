import { logger } from "../config/logger.js";
import { createProvider } from "../providers/factory.js";
import { PriceFetcher } from "../prices/fetcher.js";
import { UsdConverter } from "../utils/usdConverter.js";
import { OpportunityBuilder } from "../opportunities/builder.js";
import { formatAmount, parseHumanAmount } from "../utils/math.js";
import dexesConfig from "../../config/dexes.json" assert { type: "json" };

/**
 * Options for scan-once command
 */
export interface ScanOnceOptions {
  rpcOverride?: string;
  pairs?: string[];
  dexes?: string[];
  amount?: string;
  amountHuman?: string;
  minSpreadBps?: number;
}

/**
 * Scan-once command implementation
 * Scans all configured pairs and prints a sorted table of recognized opportunities
 */
export async function scanOnce(options: ScanOnceOptions = {}): Promise<void> {
  logger.info("=== Scan-Once: Opportunity Recognition ===");

  // Create provider and components
  const provider = createProvider(options.rpcOverride);
  const fetcher = new PriceFetcher(provider);
  const usdConverter = new UsdConverter(provider, fetcher);
  const builder = new OpportunityBuilder(provider, fetcher, usdConverter);

  // Parse pairs if provided
  let pairFilters: Array<{ tokenA: string; tokenB: string }> | undefined;
  if (options.pairs) {
    pairFilters = options.pairs.map(pairStr => {
      const [symbolA, symbolB] = pairStr.split("/");
      const tokenAInfo = fetcher.getTokenInfo(symbolA);
      const tokenBInfo = fetcher.getTokenInfo(symbolB);
      
      if (!tokenAInfo || !tokenBInfo) {
        throw new Error(`Token not found: ${symbolA} or ${symbolB}`);
      }
      
      return {
        tokenA: tokenAInfo.address,
        tokenB: tokenBInfo.address,
      };
    });
    
    logger.info(`Filtering for pairs: ${options.pairs.join(", ")}`);
  }

  // Parse DEX filters (future: apply to fetcher)
  if (options.dexes) {
    logger.info(`Filtering for DEXes: ${options.dexes.join(", ")}`);
    logger.warn("DEX filtering not yet implemented, scanning all enabled DEXes");
  }

  // Parse amount override
  let sizeOverride: Record<string, bigint> | undefined;
  let humanReadableSize: string | undefined;
  
  if (options.amountHuman && options.amount) {
    throw new Error("Cannot specify both --amount and --amount-human. Use one or the other.");
  }
  
  if (options.amountHuman) {
    // Parse human-readable amount
    const parsed = parseHumanAmount(options.amountHuman, (symbol: string) => {
      const tokenInfo = fetcher.getTokenInfo(symbol);
      if (!tokenInfo) return null;
      return {
        decimals: tokenInfo.decimals,
        address: tokenInfo.address,
      };
    });
    
    if (!parsed) {
      throw new Error(`Invalid --amount-human format: '${options.amountHuman}'. Expected format: '1 WETH' or '2000 USDC'`);
    }
    
    sizeOverride = {
      [parsed.address.toLowerCase()]: parsed.amount,
    };
    
    humanReadableSize = `${formatAmount(parsed.amount, parsed.decimals, 6)} ${parsed.symbol}`;
    logger.info(`Using human-readable amount: ${humanReadableSize} (${parsed.amount.toString()} wei)`);
  } else if (options.amount) {
    const amount = BigInt(options.amount);
    sizeOverride = {
      [dexesConfig.zkSyncEra.tokens.WETH.address.toLowerCase()]: amount,
      [dexesConfig.zkSyncEra.tokens.USDC.address.toLowerCase()]: amount,
      [dexesConfig.zkSyncEra.tokens.USDT.address.toLowerCase()]: amount,
    };
    logger.info(`Using override amount: ${amount.toString()} wei`);
  }

  // Parse min spread
  const minSpreadBps = options.minSpreadBps ? BigInt(options.minSpreadBps) : 0n;
  logger.info(`Minimum spread filter: ${minSpreadBps} bps`);

  logger.info("Starting opportunity scan...");
  logger.info("========================================");

  // Scan for opportunities
  const opportunities = await builder.scanOpportunities({
    pairs: pairFilters,
    sizes: sizeOverride,
    minSpreadBps,
  });

  // Sort by gross spread (descending)
  opportunities.sort((a, b) => {
    const diff = b.grossSpreadBps - a.grossSpreadBps;
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  });

  // Display results
  logger.info(`\n=== Found ${opportunities.length} Recognized Opportunities ===\n`);

  if (opportunities.length === 0) {
    logger.info("No opportunities found with the current filters.");
    return;
  }

  // Print table header
  console.log(
    "┌─────────────┬──────────────┬───────────────┬───────────────┬──────────────┬──────────────┬──────────────┬──────────────┐"
  );
  console.log(
    "│    Pair     │    Size      │   Path A      │   Path B      │  Zero Spread │  Slip Spread │  Est. Profit │  Executable  │"
  );
  console.log(
    "├─────────────┼──────────────┼───────────────┼───────────────┼──────────────┼──────────────┼──────────────┼──────────────┤"
  );

  // Print opportunities
  for (const opp of opportunities) {
    const tokenAMeta = usdConverter.getTokenMeta(opp.tokenA);
    const pair = `${opp.tokenASymbol}/${opp.tokenBSymbol}`;
    const size = formatAmount(opp.amountIn, tokenAMeta!.decimals, 2);
    const pathA = `${opp.quoteAtoB.dex.slice(0, 12)}`;
    const pathB = `${opp.quoteBtoA.dex.slice(0, 12)}`;
    const zeroSpread = `${(Number(opp.grossSpreadBps) / 100).toFixed(2)}%`;
    const slipSpread = `${(Number(opp.slipAdjSpreadBps) / 100).toFixed(2)}%`;
    const netProfit = `$${(Number(opp.netProfitEst) / 1e6).toFixed(2)}`;
    const executable = opp.executable ? "✓" : "✗";

    console.log(
      `│ ${pair.padEnd(11)} │ ${size.padEnd(12)} │ ${pathA.padEnd(13)} │ ${pathB.padEnd(13)} │ ${zeroSpread.padEnd(12)} │ ${slipSpread.padEnd(12)} │ ${netProfit.padEnd(12)} │ ${executable.padEnd(12)} │`
    );
  }

  console.log(
    "└─────────────┴──────────────┴───────────────┴───────────────┴──────────────┴──────────────┴──────────────┴──────────────┘"
  );

  // Print summary
  const recognizedCount = opportunities.filter(o => o.recognized).length;
  const executableCount = opportunities.filter(o => o.executable).length;
  
  logger.info(`\n=== Summary ===`);
  logger.info(`Total Recognized: ${recognizedCount}`);
  logger.info(`Executable: ${executableCount}`);
  logger.info(`Not Executable: ${recognizedCount - executableCount}`);

  // Print top 3 details
  if (opportunities.length > 0) {
    logger.info(`\n=== Top 3 Opportunities (Detail) ===`);
    
    for (let i = 0; i < Math.min(3, opportunities.length); i++) {
      const opp = opportunities[i];
      const tokenAMeta = usdConverter.getTokenMeta(opp.tokenA);
      const tokenBMeta = usdConverter.getTokenMeta(opp.tokenB);
      
      logger.info(`\n${i + 1}. ${opp.tokenASymbol}/${opp.tokenBSymbol}:`);
      logger.info(`   Size: ${formatAmount(opp.amountIn, tokenAMeta!.decimals, 6)} ${opp.tokenASymbol}`);
      
      // Path A with metadata
      let pathAInfo = `   Path A (${opp.tokenASymbol} → ${opp.tokenBSymbol}): ${opp.quoteAtoB.dex}`;
      if (opp.quoteAtoB.metadata) {
        const metaParts: string[] = [];
        if (opp.quoteAtoB.metadata.poolType) metaParts.push(`type: ${opp.quoteAtoB.metadata.poolType}`);
        if (opp.quoteAtoB.metadata.method) metaParts.push(`method: ${opp.quoteAtoB.metadata.method}`);
        if (metaParts.length > 0) {
          pathAInfo += ` [${metaParts.join(', ')}]`;
        }
      }
      logger.info(pathAInfo);
      logger.info(`     Amount Out: ${formatAmount(opp.quoteAtoB.amountOut, tokenBMeta!.decimals, 6)} ${opp.tokenBSymbol}`);
      
      // Path B with metadata
      let pathBInfo = `   Path B (${opp.tokenBSymbol} → ${opp.tokenASymbol}): ${opp.quoteBtoA.dex}`;
      if (opp.quoteBtoA.metadata) {
        const metaParts: string[] = [];
        if (opp.quoteBtoA.metadata.poolType) metaParts.push(`type: ${opp.quoteBtoA.metadata.poolType}`);
        if (opp.quoteBtoA.metadata.method) metaParts.push(`method: ${opp.quoteBtoA.metadata.method}`);
        if (metaParts.length > 0) {
          pathBInfo += ` [${metaParts.join(', ')}]`;
        }
      }
      logger.info(pathBInfo);
      logger.info(`     Amount Out: ${formatAmount(opp.quoteBtoA.amountOut, tokenAMeta!.decimals, 6)} ${opp.tokenASymbol}`);
      
      logger.info(`   Gross Spread: ${(Number(opp.grossSpreadBps) / 100).toFixed(4)}%`);
      logger.info(`   Slip-Adj Spread: ${(Number(opp.slipAdjSpreadBps) / 100).toFixed(4)}%`);
      logger.info(`   USD Value In: $${(Number(opp.usdValueIn) / 1e6).toFixed(2)}`);
      logger.info(`   USD Value Out: $${(Number(opp.usdValueOut) / 1e6).toFixed(2)}`);
      logger.info(`   Est. Gas Cost: $${(Number(await usdConverter.convertToUsd(dexesConfig.zkSyncEra.tokens.WETH.address, opp.estimatedGasCost)) / 1e6).toFixed(2)}`);
      logger.info(`   Est. Net Profit: $${(Number(opp.netProfitEst) / 1e6).toFixed(2)}`);
      logger.info(`   Executable: ${opp.executable ? "Yes" : "No"}`);
    }
  }

  logger.info("\n========================================");
}
