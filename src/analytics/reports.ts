import { AnalyticsDB } from "./db.js";
import { logger } from "../config/logger.js";

/**
 * Generate PnL reports
 */
export class ReportGenerator {
  private db: AnalyticsDB;

  constructor() {
    this.db = new AnalyticsDB();
  }

  /**
   * Generate summary report
   */
  generateSummary(): void {
    const totalPnL = this.db.getTotalPnL();
    const tradeCount = this.db.getTradeCount();
    const recentTrades = this.db.getRecentTrades(5);

    logger.info("=== PnL Summary Report ===");
    logger.info(`Total Trades: ${tradeCount}`);
    logger.info(`Total PnL: ${totalPnL.toString()}`);
    logger.info(`Recent Trades (${recentTrades.length}):`);

    recentTrades.forEach((trade, idx) => {
      logger.info(
        `  ${idx + 1}. ${trade.tokenIn} -> ${trade.tokenOut}: ${trade.profit} profit (tx: ${trade.txHash.slice(0, 10)}...)`
      );
    });
  }

  /**
   * Close resources
   */
  close(): void {
    this.db.close();
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const generator = new ReportGenerator();
  generator.generateSummary();
  generator.close();
  process.exit(0);
}
