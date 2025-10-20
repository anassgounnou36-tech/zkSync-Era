import Database from "better-sqlite3";
import { logger } from "../config/logger.js";
import { loadConfig } from "../config/config.js";
import * as fs from "fs";
import * as path from "path";

const config = loadConfig();

export interface TradeRecord {
  id?: number;
  timestamp: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  profit: string;
  gasUsed: string;
  txHash: string;
}

/**
 * Database for analytics and trade tracking
 */
export class AnalyticsDB {
  private db: Database.Database;

  constructor(dbPath: string = config.dbPath) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.migrate();
    logger.info({ dbPath }, "Analytics database initialized");
  }

  /**
   * Run database migrations
   */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        tokenIn TEXT NOT NULL,
        tokenOut TEXT NOT NULL,
        amountIn TEXT NOT NULL,
        amountOut TEXT NOT NULL,
        profit TEXT NOT NULL,
        gasUsed TEXT NOT NULL,
        txHash TEXT NOT NULL UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_timestamp ON trades(timestamp);
      CREATE INDEX IF NOT EXISTS idx_txHash ON trades(txHash);
    `);

    logger.info("Database migrations complete");
  }

  /**
   * Record a trade
   */
  recordTrade(trade: TradeRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO trades (timestamp, tokenIn, tokenOut, amountIn, amountOut, profit, gasUsed, txHash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      trade.timestamp,
      trade.tokenIn,
      trade.tokenOut,
      trade.amountIn,
      trade.amountOut,
      trade.profit,
      trade.gasUsed,
      trade.txHash
    );

    logger.info({ trade }, "Trade recorded");
  }

  /**
   * Get total PnL
   */
  getTotalPnL(): bigint {
    const result = this.db.prepare("SELECT SUM(CAST(profit AS INTEGER)) as total FROM trades").get() as {
      total: number | null;
    };
    return BigInt(result.total || 0);
  }

  /**
   * Get trade count
   */
  getTradeCount(): number {
    const result = this.db.prepare("SELECT COUNT(*) as count FROM trades").get() as { count: number };
    return result.count;
  }

  /**
   * Get recent trades
   */
  getRecentTrades(limit: number = 10): TradeRecord[] {
    return this.db
      .prepare("SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?")
      .all(limit) as TradeRecord[];
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    logger.info("Database connection closed");
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);

  if (args.includes("migrate")) {
    const db = new AnalyticsDB();
    logger.info("Database migration complete");
    db.close();
    process.exit(0);
  }
}
