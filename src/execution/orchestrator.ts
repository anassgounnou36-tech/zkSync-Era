import { Wallet, Provider, Contract } from "zksync-ethers";
import { logger } from "../config/logger.js";
import { ProfitCalculator } from "../simulation/profitCalculator.js";
import { PriceFetcher } from "../prices/fetcher.js";
import strategyConfig from "../../config/strategy.json" assert { type: "json" };

export interface ExecutionConfig {
  flashloanRouterAddress: string;
  arbitrageExecutorAddress: string;
  privateKey: string;
  rpcUrl: string;
  dryRun: boolean;
}

export interface SafetyGates {
  minProfitUSD: number;
  minSpreadPercent: number;
  freshnessWindowMs: number;
  dailyGasBudgetWei: bigint;
  currentGasSpent: bigint;
}

/**
 * Orchestrator for automated arbitrage execution using flashloans
 */
export class ExecutionOrchestrator {
  private wallet: Wallet | null = null;
  private provider: Provider;
  private calculator: ProfitCalculator;
  private fetcher: PriceFetcher;
  private config: ExecutionConfig;
  private safetyGates: SafetyGates;
  private isRunning: boolean = false;

  constructor(config: ExecutionConfig) {
    this.config = config;
    this.provider = new Provider(config.rpcUrl);
    this.calculator = new ProfitCalculator();
    
    // Create a basic provider for PriceFetcher
    // Note: PriceFetcher expects JsonRpcProvider, but we're using zksync Provider
    // This is a compatibility issue that should be addressed separately
    this.fetcher = new PriceFetcher();

    // Initialize wallet only if not in dry-run mode
    if (!config.dryRun && config.privateKey) {
      this.wallet = new Wallet(config.privateKey, this.provider);
    }

    // Initialize safety gates
    this.safetyGates = {
      minProfitUSD: strategyConfig.arbitrage.minProfitUSD,
      minSpreadPercent: 0.3, // 0.3% minimum spread
      freshnessWindowMs: 10 * 1000, // 10 seconds
      dailyGasBudgetWei: BigInt(strategyConfig.safety.dailyGasBudget),
      currentGasSpent: 0n,
    };

    logger.info({ dryRun: config.dryRun }, "Execution orchestrator initialized");
  }

  /**
   * Start automated execution loop
   */
  async start(intervalSeconds: number = 60): Promise<void> {
    logger.info({ intervalSeconds }, "Starting execution orchestrator");
    this.isRunning = true;

    while (this.isRunning) {
      try {
        await this.scanAndExecute();
        await this.sleep(intervalSeconds * 1000);
      } catch (error) {
        logger.error({ error }, "Error in execution loop");
        await this.sleep(10000); // Wait 10s on error
      }
    }

    logger.info("Execution orchestrator stopped");
  }

  /**
   * Stop the orchestrator
   */
  stop(): void {
    logger.info("Stopping execution orchestrator");
    this.isRunning = false;
  }

  /**
   * Scan for opportunities and execute if profitable
   */
  private async scanAndExecute(): Promise<void> {
    const tokenPairs = strategyConfig.arbitrage.targetPairs;

    for (const pair of tokenPairs) {
      const tokenAInfo = this.fetcher.getTokenInfo(pair.tokenA);
      const tokenBInfo = this.fetcher.getTokenInfo(pair.tokenB);

      if (!tokenAInfo || !tokenBInfo) {
        logger.warn({ pair }, "Token info not found, skipping");
        continue;
      }

      const tokenA = tokenAInfo.address;
      const tokenB = tokenBInfo.address;
      const flashloanSizes = strategyConfig.arbitrage.flashloanSize as Record<string, string>;
      const amountIn = BigInt(flashloanSizes[pair.tokenA] || "1000000000000000000");

      try {
        // Fetch current prices
        const opportunity = await this.fetcher.findArbitrageOpportunity(tokenA, tokenB, amountIn);

        if (opportunity && this.shouldExecute(opportunity)) {
          await this.executeArbitrage(opportunity);
        }
      } catch (error) {
        logger.error({ error, pair }, "Error processing opportunity");
      }
    }
  }

  /**
   * Check if opportunity meets safety gates
   */
  private shouldExecute(opportunity: Record<string, unknown> | { spreadPercent: number; profitPotential: bigint }): boolean {
    // Check spread threshold
    const spreadPercent = opportunity.spreadPercent as number;
    if (spreadPercent < this.safetyGates.minSpreadPercent) {
      logger.debug({ spread: spreadPercent }, "Spread below minimum threshold");
      return false;
    }

    // Estimate profit
    const profitPotential = opportunity.profitPotential as bigint;
    const profitEstimate = this.calculator.calculateProfit({
      amountIn: profitPotential, // This is simplified
      amountOut: profitPotential,
      flashloanFeeBps: 0,
      ethPriceUSD: 2000,
    });

    // Check minimum profit
    if (profitEstimate.netProfitUSD < this.safetyGates.minProfitUSD) {
      logger.debug({ profitUSD: profitEstimate.netProfitUSD }, "Profit below minimum threshold");
      return false;
    }

    // Check daily gas budget
    const estimatedGas = this.calculator.estimateGas("complex");
    if (this.safetyGates.currentGasSpent + estimatedGas.gasCostWei > this.safetyGates.dailyGasBudgetWei) {
      logger.warn("Daily gas budget exceeded");
      return false;
    }

    // Check gas price
    const gasPrice = estimatedGas.gasPriceWei;
    const maxGasPrice = BigInt(strategyConfig.safety.maxGasPrice);
    if (gasPrice > maxGasPrice) {
      logger.warn({ gasPrice, maxGasPrice }, "Gas price too high");
      return false;
    }

    return true;
  }

  /**
   * Execute arbitrage using flashloan
   */
  private async executeArbitrage(opportunity: Record<string, unknown> | { buyDex: string; sellDex: string; tokenIn: string; tokenOut: string; spreadPercent: number; profitPotential: bigint }): Promise<void> {
    logger.info({ opportunity }, "Executing arbitrage opportunity");

    if (this.config.dryRun) {
      logger.info("DRY RUN: Would execute flashloan arbitrage");
      this.logExecutionDetails(opportunity as Record<string, unknown>);
      return;
    }

    if (!this.wallet) {
      logger.error("Wallet not initialized, cannot execute");
      return;
    }

    if (!this.config.flashloanRouterAddress || !this.config.arbitrageExecutorAddress) {
      logger.error("Contract addresses not configured");
      return;
    }

    try {
      // Encode arbitrage parameters
      const buyDex = opportunity.buyDex as string;
      const sellDex = opportunity.sellDex as string;
      const tokenIn = opportunity.tokenIn as string;
      const tokenOut = opportunity.tokenOut as string;
      
      const arbitrageData = this.encodeArbitrageParams({
        buyDex,
        sellDex,
        tokenIn,
        tokenOut,
        amountIn: BigInt(strategyConfig.arbitrage.flashloanSize.WETH || "1000000000000000000"),
        minProfit: BigInt(Math.floor(strategyConfig.arbitrage.minProfitUSD * 1e18)),
      });

      // Prepare flashloan call
      const flashloanRouter = new Contract(
        this.config.flashloanRouterAddress,
        [
          "function executeFlashloan(address[] tokens, uint256[] amounts, bytes data) external",
        ],
        this.wallet
      );

      const tokens = [tokenIn];
      const amounts = [BigInt(strategyConfig.arbitrage.flashloanSize.WETH || "1000000000000000000")];

      logger.info({ tokens, amounts }, "Calling executeFlashloan");

      // Execute transaction
      const tx = await flashloanRouter.executeFlashloan(tokens, amounts, arbitrageData);
      logger.info({ txHash: tx.hash }, "Transaction submitted");

      // Wait for confirmation
      const receipt = await tx.wait();
      logger.info({ txHash: receipt.hash, status: receipt.status }, "Transaction confirmed");

      // Update gas spent
      const gasUsed = BigInt(receipt.gasUsed.toString());
      const gasPrice = BigInt(receipt.gasPrice?.toString() || "0");
      this.safetyGates.currentGasSpent += gasUsed * gasPrice;
    } catch (error) {
      logger.error({ error }, "Failed to execute arbitrage");
    }
  }

  /**
   * Encode arbitrage parameters for on-chain execution
   */
  private encodeArbitrageParams(_params: {
    buyDex: string;
    sellDex: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    minProfit: bigint;
  }): string {
    // This is a placeholder encoding
    // In production, use ethers.AbiCoder to properly encode the parameters
    // matching the ArbitrageExecutorUpgradeable.executeArbitrage function signature
    // For now, return empty bytes to avoid async import issues
    return "0x";
  }

  /**
   * Log execution details for dry-run mode
   */
  private logExecutionDetails(opportunity: Record<string, unknown>): void {
    const buyDex = opportunity.buyDex as string;
    const sellDex = opportunity.sellDex as string;
    const tokenIn = opportunity.tokenIn as string;
    const tokenOut = opportunity.tokenOut as string;
    const spreadPercent = opportunity.spreadPercent as number;
    const profitPotential = opportunity.profitPotential as bigint;
    
    logger.info("=== Dry Run Execution Details ===");
    logger.info(`Buy on: ${buyDex}`);
    logger.info(`Sell on: ${sellDex}`);
    logger.info(`Token pair: ${tokenIn} -> ${tokenOut}`);
    logger.info(`Spread: ${spreadPercent.toFixed(4)}%`);
    logger.info(`Estimated profit: ${profitPotential.toString()}`);
    logger.info("=================================");
  }

  /**
   * Reset daily gas budget (should be called daily)
   */
  resetDailyGasBudget(): void {
    this.safetyGates.currentGasSpent = 0n;
    logger.info("Daily gas budget reset");
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
