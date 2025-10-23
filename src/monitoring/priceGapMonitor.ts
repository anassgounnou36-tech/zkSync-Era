import Database from "better-sqlite3";
import { logger } from "../config/logger.js";
import { PriceFetcher, DexPrice } from "../prices/fetcher.js";
import { ProfitCalculator } from "../simulation/profitCalculator.js";
import { createProvider } from "../providers/factory.js";
import strategyConfig from "../../config/strategy.json" assert { type: "json" };
import * as fs from "fs";
import * as path from "path";

export interface PriceGap {
  id?: number;
  timestamp: number;
  tokenA: string;
  tokenB: string;
  buyDex: string;
  sellDex: string;
  spreadPercent: number;
  profitUSD: number;
  status: "open" | "closed";
  closedAt?: number;
  decayTimeSeconds?: number;
}

export interface HourlyStats {
  hour: string;
  opportunityCount: number;
  avgSpread: number;
  maxSpread: number;
  avgDecayTime: number;
}

export interface MonitoringReport {
  startTime: number;
  endTime: number;
  durationHours: number;
  totalOpportunities: number;
  closedOpportunities: number;
  avgDecayTimeSeconds: number;
  hourlyStats: HourlyStats[];
  topOpportunities: PriceGap[];
}

/**
 * Continuous price gap monitoring system
 */
export class PriceGapMonitor {
  private db: Database.Database;
  private fetcher: PriceFetcher;
  private calculator: ProfitCalculator;
  private isRunning: boolean = false;
  private startTime: number = 0;
  private dbPath: string;

  constructor(dbPath: string = "./data/monitoring.sqlite", rpcOverride?: string) {
    this.dbPath = dbPath;
    
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    
    // Use provider factory for consistent RPC selection
    const provider = createProvider(rpcOverride);
    this.fetcher = new PriceFetcher(provider);
    
    this.calculator = new ProfitCalculator();
    this.initDatabase();
    logger.info({ dbPath }, "Price gap monitor initialized");
  }

  /**
   * Initialize database schema
   */
  private initDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS price_gaps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        tokenA TEXT NOT NULL,
        tokenB TEXT NOT NULL,
        buyDex TEXT NOT NULL,
        sellDex TEXT NOT NULL,
        spreadPercent REAL NOT NULL,
        profitUSD REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        closedAt INTEGER,
        decayTimeSeconds INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_timestamp ON price_gaps(timestamp);
      CREATE INDEX IF NOT EXISTS idx_status ON price_gaps(status);
      CREATE INDEX IF NOT EXISTS idx_token_pair ON price_gaps(tokenA, tokenB);
    `);

    logger.info("Database schema initialized");
  }

  /**
   * Start continuous monitoring
   */
  async start(durationHours: number = 48): Promise<void> {
    logger.info({ durationHours }, "Starting continuous price gap monitoring");
    this.isRunning = true;
    this.startTime = Date.now();
    const endTime = this.startTime + durationHours * 60 * 60 * 1000;

    let scanCount = 0;

    while (this.isRunning && Date.now() < endTime) {
      try {
        scanCount++;
        await this.scanPriceGaps();

        // Update closed opportunities
        this.updateClosedOpportunities();

        // Log hourly stats
        if (scanCount % 60 === 0) {
          // Every ~60 scans (assuming ~1 min per scan)
          this.logHourlyStats();
        }

        // Wait before next scan (60 seconds)
        await this.sleep(60000);
      } catch (error) {
        logger.error({ error }, "Error during price gap scan");
        await this.sleep(10000); // Wait 10s on error before retrying
      }
    }

    logger.info({ scanCount }, "Monitoring completed");
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    logger.info("Stopping price gap monitor");
    this.isRunning = false;
  }

  /**
   * Scan for price gaps across configured DEX pairs
   */
  private async scanPriceGaps(): Promise<void> {
    const config = strategyConfig.arbitrage;
    const tokenPairs = config.targetPairs;

    for (const pair of tokenPairs) {
      const tokenAInfo = this.fetcher.getTokenInfo(pair.tokenA);
      const tokenBInfo = this.fetcher.getTokenInfo(pair.tokenB);

      if (!tokenAInfo || !tokenBInfo) {
        logger.warn({ pair }, "Token info not found, skipping pair");
        continue;
      }

      const tokenA = tokenAInfo.address;
      const tokenB = tokenBInfo.address;

      // Use flashloan size from config
      const flashloanSizes = config.flashloanSize as Record<string, string>;
      const amountIn = BigInt(flashloanSizes[pair.tokenA] || "1000000000000000000");

      try {
        // Fetch prices from all DEXes for both directions
        const pricesAtoB = await this.fetcher.fetchAllPrices(tokenA, tokenB, amountIn);
        const pricesBtoA = await this.fetcher.fetchAllPrices(tokenB, tokenA, amountIn);

        // Find opportunities
        this.findAndRecordOpportunities(pricesAtoB, pricesBtoA, pair.tokenA, pair.tokenB);
      } catch (error) {
        logger.error({ error, pair }, "Error scanning price gap for pair");
      }
    }
  }

  /**
   * Find and record arbitrage opportunities from price quotes
   */
  private findAndRecordOpportunities(
    pricesAtoB: DexPrice[],
    pricesBtoA: DexPrice[],
    tokenASymbol: string,
    tokenBSymbol: string
  ): void {
    const minSpreadPercent = 0.1; // Minimum 0.1% spread to record

    for (const buyPrice of pricesAtoB) {
      if (!buyPrice.success || buyPrice.amountOut === 0n) continue;

      for (const sellPrice of pricesBtoA) {
        if (!sellPrice.success || sellPrice.amountOut === 0n) continue;

        // Calculate spread
        const buyRate = Number(buyPrice.amountOut) / Number(buyPrice.amountIn);
        const sellRate = Number(sellPrice.amountOut) / Number(sellPrice.amountIn);
        
        // For A->B->A arbitrage: we buy B with A, then sell B for A
        // We want: (sellRate * buyRate) > 1
        const roundTripRate = buyRate * sellRate;
        const spreadPercent = (roundTripRate - 1) * 100;

        logger.debug(
          {
            pair: `${tokenASymbol}/${tokenBSymbol}`,
            buyDex: buyPrice.dex,
            sellDex: sellPrice.dex,
            buyRate,
            sellRate,
            roundTripRate,
            spreadPercent,
          },
          "Evaluating arbitrage opportunity"
        );

        if (spreadPercent > minSpreadPercent) {
          // Estimate profit
          const amountB = buyPrice.amountOut;
          const finalA = (amountB * BigInt(Math.floor(sellRate * 1e18))) / BigInt(1e18);

          // Calculate net profit with gas costs
          const profitEstimate = this.calculator.calculateProfit({
            amountIn: buyPrice.amountIn,
            amountOut: finalA,
            flashloanFeeBps: 0,
            ethPriceUSD: 2000, // TODO: Get live ETH price
          });

          logger.debug(
            {
              pair: `${tokenASymbol}/${tokenBSymbol}`,
              buyDex: buyPrice.dex,
              sellDex: sellPrice.dex,
              spreadPercent,
              grossProfit: (finalA - buyPrice.amountIn).toString(),
              gasCost: profitEstimate.gasCost.toString(),
              netProfitUSD: profitEstimate.netProfitUSD,
              isProfitable: profitEstimate.isProfitable,
            },
            profitEstimate.netProfitUSD > 0
              ? "Opportunity is profitable - recording"
              : "Opportunity not profitable - skipping"
          );

          // Record opportunity if profitable
          if (profitEstimate.netProfitUSD > 0) {
            this.recordOpportunity({
              timestamp: Date.now(),
              tokenA: tokenASymbol,
              tokenB: tokenBSymbol,
              buyDex: buyPrice.dex,
              sellDex: sellPrice.dex,
              spreadPercent,
              profitUSD: profitEstimate.netProfitUSD,
              status: "open",
            });
          }
        } else {
          logger.debug(
            {
              pair: `${tokenASymbol}/${tokenBSymbol}`,
              buyDex: buyPrice.dex,
              sellDex: sellPrice.dex,
              spreadPercent,
              minSpreadPercent,
            },
            "Spread below minimum threshold - skipping"
          );
        }
      }
    }
  }

  /**
   * Record a new opportunity
   */
  private recordOpportunity(gap: PriceGap): void {
    const stmt = this.db.prepare(`
      INSERT INTO price_gaps (timestamp, tokenA, tokenB, buyDex, sellDex, spreadPercent, profitUSD, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      gap.timestamp,
      gap.tokenA,
      gap.tokenB,
      gap.buyDex,
      gap.sellDex,
      gap.spreadPercent,
      gap.profitUSD,
      gap.status
    );

    logger.debug({ gap }, "Opportunity recorded");
  }

  /**
   * Update closed opportunities (opportunities that no longer exist)
   */
  private updateClosedOpportunities(): void {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    // Mark opportunities older than 5 minutes as closed if still open
    const stmt = this.db.prepare(`
      UPDATE price_gaps
      SET status = 'closed',
          closedAt = ?,
          decayTimeSeconds = (? - timestamp) / 1000
      WHERE status = 'open' AND timestamp < ?
    `);

    const result = stmt.run(Date.now(), Date.now(), fiveMinutesAgo);

    if (result.changes > 0) {
      logger.debug({ closedCount: result.changes }, "Updated closed opportunities");
    }
  }

  /**
   * Log hourly statistics
   */
  private logHourlyStats(): void {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    const result = this.db.prepare(`
      SELECT 
        COUNT(*) as count,
        AVG(spreadPercent) as avgSpread,
        MAX(spreadPercent) as maxSpread,
        AVG(decayTimeSeconds) as avgDecay
      FROM price_gaps
      WHERE timestamp > ?
    `).get(oneHourAgo) as {
      count: number;
      avgSpread: number;
      maxSpread: number;
      avgDecay: number | null;
    };

    logger.info({
      opportunityCount: result.count,
      avgSpread: result.avgSpread?.toFixed(4),
      maxSpread: result.maxSpread?.toFixed(4),
      avgDecayTime: result.avgDecay?.toFixed(2),
    }, "Hourly statistics");
  }

  /**
   * Generate final monitoring report
   */
  generateReport(): MonitoringReport {
    const endTime = Date.now();
    const durationMs = endTime - this.startTime;
    const durationHours = durationMs / (60 * 60 * 1000);

    // Get total statistics
    const totalStats = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'closed' THEN 1 END) as closed,
        AVG(decayTimeSeconds) as avgDecay
      FROM price_gaps
      WHERE timestamp >= ?
    `).get(this.startTime) as {
      total: number;
      closed: number;
      avgDecay: number | null;
    };

    // Get hourly statistics
    const hourlyStats = this.getHourlyStats();

    // Get top opportunities
    const topOpportunities = this.db.prepare(`
      SELECT *
      FROM price_gaps
      WHERE timestamp >= ?
      ORDER BY profitUSD DESC
      LIMIT 20
    `).all(this.startTime) as PriceGap[];

    const report: MonitoringReport = {
      startTime: this.startTime,
      endTime,
      durationHours,
      totalOpportunities: totalStats.total,
      closedOpportunities: totalStats.closed,
      avgDecayTimeSeconds: totalStats.avgDecay || 0,
      hourlyStats,
      topOpportunities,
    };

    return report;
  }

  /**
   * Get hourly statistics breakdown
   */
  private getHourlyStats(): HourlyStats[] {
    const stats: HourlyStats[] = [];
    const durationMs = Date.now() - this.startTime;
    const hours = Math.ceil(durationMs / (60 * 60 * 1000));

    for (let i = 0; i < hours; i++) {
      const hourStart = this.startTime + i * 60 * 60 * 1000;
      const hourEnd = hourStart + 60 * 60 * 1000;

      const result = this.db.prepare(`
        SELECT 
          COUNT(*) as count,
          AVG(spreadPercent) as avgSpread,
          MAX(spreadPercent) as maxSpread,
          AVG(decayTimeSeconds) as avgDecay
        FROM price_gaps
        WHERE timestamp >= ? AND timestamp < ?
      `).get(hourStart, hourEnd) as {
        count: number;
        avgSpread: number | null;
        maxSpread: number | null;
        avgDecay: number | null;
      };

      const hourDate = new Date(hourStart);
      stats.push({
        hour: hourDate.toISOString(),
        opportunityCount: result.count,
        avgSpread: result.avgSpread || 0,
        maxSpread: result.maxSpread || 0,
        avgDecayTime: result.avgDecay || 0,
      });
    }

    return stats;
  }

  /**
   * Save report to JSON file
   */
  saveReport(outputPath: string = "./monitoring-report.json"): void {
    const report = this.generateReport();

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    logger.info({ outputPath }, "Monitoring report saved");
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    logger.info("Price gap monitor closed");
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
