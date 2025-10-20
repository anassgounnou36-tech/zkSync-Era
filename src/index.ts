import { logger } from "./config/logger.js";
import { loadConfig } from "./config/config.js";
import { MempoolMonitor } from "./mempool/monitor.js";
import { ArbitrageSimulator } from "./simulation/simulate.js";
import { ArbitrageExecutor } from "./execution/executor.js";
import { TelegramBot } from "./telegram/bot.js";
import { AnalyticsDB } from "./analytics/db.js";

const config = loadConfig();

/**
 * Main orchestration entry point
 */
async function main() {
  logger.info("Starting zkSync Era Arbitrage Bot...");
  logger.info({ config: { dryRun: config.dryRun, logLevel: config.logLevel } }, "Configuration loaded");

  // Initialize components
  const monitor = new MempoolMonitor(
    config.dryRun ? config.zkSyncTestnetRpcUrl : config.zkSyncRpcUrl
  );
  // Simulator and executor initialized for future orchestration logic
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _simulator = new ArbitrageSimulator();
  
  // Only initialize executor if we have a valid private key
  let _executor;
  if (config.privateKey && config.privateKey !== "0x" + "0".repeat(64)) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _executor = new ArbitrageExecutor(
      config.privateKey,
      config.dryRun ? config.zkSyncTestnetRpcUrl : config.zkSyncRpcUrl
    );
  } else {
    logger.warn("No valid private key configured - executor disabled");
  }
  
  const telegramBot = new TelegramBot();
  const db = new AnalyticsDB();

  // Start Telegram bot
  await telegramBot.start();

  // Start monitoring (placeholder orchestration)
  logger.info("Bot components initialized and ready");
  logger.info("Press Ctrl+C to stop");

  // Keep process alive
  await new Promise(() => {
    // Infinite wait - process will be killed by SIGINT
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    monitor.stop();
    telegramBot.stop();
    db.close();
    process.exit(0);
  });
}

// Check for CLI adapter flag
const args = process.argv.slice(2);
if (args.includes("--adapter") && args.includes("cli")) {
  main().catch((error) => {
    logger.error({ error: error.message, stack: error.stack }, "Fatal error");
    process.exit(1);
  });
}
