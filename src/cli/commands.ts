#!/usr/bin/env node

import { Command } from "commander";
import { PriceGapMonitor } from "../monitoring/priceGapMonitor.js";
import { ExecutionOrchestrator } from "../execution/orchestrator.js";
import { logger } from "../config/logger.js";
import { loadConfig } from "../config/config.js";
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
  .option("-d, --duration <hours>", "Duration in hours", "48")
  .option("--db <path>", "Database path", "./data/monitoring.sqlite")
  .action(async (options) => {
    logger.info({ options }, "Starting monitor command");

    const duration = parseInt(options.duration);
    const monitor = new PriceGapMonitor(options.db);

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

// Parse command-line arguments
program.parse();
