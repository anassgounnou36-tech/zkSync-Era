#!/usr/bin/env node

import { Command } from "commander";
import { PriceGapMonitor } from "../monitoring/priceGapMonitor.js";
import { ExecutionOrchestrator } from "../execution/orchestrator.js";
import { logger } from "../config/logger.js";
import { loadConfig } from "../config/config.js";
import { diagHealth, diagQuotes, diagConfig } from "./diag.js";
import dexesConfig from "../../config/dexes.json" assert { type: "json" };

const program = new Command();

program
  .name("arb-bot-cli")
  .description("zkSync Era Arbitrage Bot CLI")
  .version("0.1.0");

/**
 * Monitor command - continuous price gap monitoring
 */
program
  .command("monitor")
  .description("Run continuous price gap monitoring")
  .option("-d, --duration <hours>", "Duration in hours (supports decimals, e.g., 0.2 for 12 minutes)", "48")
  .option("--db <path>", "Database path", "./data/monitoring.sqlite")
  .option("--recognize-all", "Record all recognized opportunities even if below minProfitUSD", false)
  .action(async (options) => {
    logger.info({ options }, "Starting monitor command");

    const duration = parseFloat(options.duration);
    
    // Validate duration
    if (isNaN(duration) || duration <= 0) {
      logger.error({ duration: options.duration }, "Invalid duration: must be a positive number");
      process.exit(1);
    }

    const monitor = new PriceGapMonitor(options.db, undefined, options.recognizeAll);

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      logger.info("Received SIGINT, stopping monitor...");
      monitor.stop();
      monitor.saveReport();
      monitor.close();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      logger.info("Received SIGTERM, stopping monitor...");
      monitor.stop();
      monitor.saveReport();
      monitor.close();
      process.exit(0);
    });

    try {
      await monitor.start(duration);
      
      // Generate report after monitoring completes
      monitor.saveReport();
      monitor.close();
      
      logger.info("Monitoring completed successfully");
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "Monitor failed");
      monitor.close();
      process.exit(1);
    }
  });

/**
 * Execute command - automated execution loop
 */
program
  .command("execute")
  .description("Start automated arbitrage execution")
  .option("--dry-run", "Run in dry-run mode without executing transactions", false)
  .option("-i, --interval <seconds>", "Scan interval in seconds", "60")
  .action(async (options) => {
    logger.info({ options }, "Starting execute command");

    const config = loadConfig();
    const interval = parseInt(options.interval);

    const orchestrator = new ExecutionOrchestrator({
      flashloanRouterAddress: config.flashloanRouterAddress || "",
      arbitrageExecutorAddress: config.arbitrageExecutorAddress || "",
      privateKey: config.privateKey,
      rpcUrl: config.zkSyncRpcUrl,
      dryRun: options.dryRun || config.dryRun,
    });

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      logger.info("Received SIGINT, stopping orchestrator...");
      orchestrator.stop();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      logger.info("Received SIGTERM, stopping orchestrator...");
      orchestrator.stop();
      process.exit(0);
    });

    try {
      await orchestrator.start(interval);
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "Execution failed");
      process.exit(1);
    }
  });

/**
 * Report command - generate monitoring report
 */
program
  .command("report")
  .description("Generate monitoring report from database")
  .option("--db <path>", "Database path", "./data/monitoring.sqlite")
  .option("-o, --output <path>", "Output JSON file path", "./monitoring-report.json")
  .action((options) => {
    logger.info({ options }, "Generating monitoring report");

    try {
      const monitor = new PriceGapMonitor(options.db);
      monitor.saveReport(options.output);
      
      // Also log summary to console
      const report = monitor.generateReport();
      
      logger.info("=== Monitoring Report Summary ===");
      logger.info(`Duration: ${report.durationHours.toFixed(2)} hours`);
      logger.info(`Total Opportunities: ${report.totalOpportunities}`);
      logger.info(`Closed Opportunities: ${report.closedOpportunities}`);
      logger.info(`Avg Decay Time: ${report.avgDecayTimeSeconds.toFixed(2)}s`);
      logger.info(`Top Opportunity Profit: $${report.topOpportunities[0]?.profitUSD.toFixed(2) || 0}`);
      logger.info(`Report saved to: ${options.output}`);
      logger.info("================================");

      monitor.close();
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "Failed to generate report");
      process.exit(1);
    }
  });

/**
 * Info command - display configuration and status
 */
program
  .command("info")
  .description("Display bot configuration and status")
  .action(() => {
    logger.info("=== Bot Configuration ===");
    logger.info(`Chain ID: ${dexesConfig.zkSyncEra.chainId}`);
    logger.info(`RPC URL: ${dexesConfig.zkSyncEra.rpcUrl}`);
    logger.info(`Flashloan Provider: ${dexesConfig.zkSyncEra.flashloanProvider.name}`);
    logger.info(`Vault Address: ${dexesConfig.zkSyncEra.flashloanProvider.address}`);
    logger.info(`Enabled DEXes: ${Object.entries(dexesConfig.zkSyncEra.dexes).filter(([_, dex]) => dex.enabled).map(([name]) => name).join(", ")}`);
    
    const config = loadConfig();
    logger.info(`Min Profit Threshold: $${config.minProfitThresholdUsd}`);
    logger.info(`Dry Run Mode: ${config.dryRun}`);
    logger.info("========================");
    
    process.exit(0);
  });

/**
 * Diagnostics command - RPC and DEX testing
 */
const diagCommand = program
  .command("diag")
  .description("Diagnostic commands for RPC and DEX testing");

diagCommand
  .command("health")
  .description("Test RPC connectivity and display metrics")
  .option("--rpc <url>", "Override RPC endpoint (for testing only)")
  .action(async (options) => {
    try {
      await diagHealth(options.rpc);
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "Health check failed");
      process.exit(1);
    }
  });

diagCommand
  .command("quotes")
  .description("Fetch quotes from all enabled DEXes for configured pairs")
  .option("--rpc <url>", "Override RPC endpoint (for testing only)")
  .option("--amount <amount>", "Override amount to quote (in wei)")
  .option("--dex <name>", "Filter by specific DEX name")
  .option("--pair <pair>", "Filter by specific pair (e.g., USDC/USDT)")
  .option("--syncswap-verbose", "Enable verbose logging for SyncSwap probing", false)
  .action(async (options) => {
    try {
      await diagQuotes(options.rpc, options.amount, options.dex, options.pair, options.syncswapVerbose);
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "Quote test failed");
      process.exit(1);
    }
  });

diagCommand
  .command("config")
  .description("Display DEX and token configuration")
  .action(() => {
    try {
      diagConfig();
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "Config display failed");
      process.exit(1);
    }
  });

/**
 * Scan-once command - single scan of all opportunities
 */
program
  .command("scan-once")
  .description("Scan all configured pairs once and display recognized opportunities")
  .option("--pairs <pairs>", "Comma-separated list of pairs (e.g., WETH/USDC,USDC/USDT)")
  .option("--dexes <dexes>", "Comma-separated list of DEXes to use")
  .option("--amount <amount>", "Override flashloan amount (in wei)")
  .option("--amount-human <amount>", "Override flashloan amount in human-readable format (e.g., '1 WETH', '1000 USDC')")
  .option("--min-spread-bps <bps>", "Minimum spread in basis points to display", "0")
  .option("--rpc <url>", "Override RPC endpoint (for testing only)")
  .action(async (options) => {
    logger.info({ options }, "Starting scan-once command");

    try {
      const { scanOnce } = await import("./scanOnce.js");
      await scanOnce({
        rpcOverride: options.rpc,
        pairs: options.pairs ? options.pairs.split(",") : undefined,
        dexes: options.dexes ? options.dexes.split(",") : undefined,
        amount: options.amount,
        amountHuman: options.amountHuman,
        minSpreadBps: parseInt(options.minSpreadBps),
      });
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "scan-once failed");
      process.exit(1);
    }
  });

// Parse command-line arguments
program.parse();
