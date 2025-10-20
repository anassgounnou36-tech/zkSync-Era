import strategyConfig from "../../config/strategy.json" assert { type: "json" };

export interface ProfitEstimate {
  grossProfit: bigint;
  flashloanFee: bigint;
  gasCost: bigint;
  netProfit: bigint;
  netProfitUSD: number;
  isProfitable: boolean;
  profitMarginPercent: number;
}

export interface GasEstimate {
  gasUnits: bigint;
  gasPriceWei: bigint;
  gasCostWei: bigint;
}

export class ProfitCalculator {
  private config: typeof strategyConfig;

  constructor() {
    this.config = strategyConfig;
  }

  /**
   * Estimate gas cost for arbitrage transaction
   * @param complexity Simple (1-2 swaps) or Complex (3+ swaps, flashloan)
   */
  estimateGas(complexity: "simple" | "complex" = "simple"): GasEstimate {
    // zkSync Era gas estimates (conservative)
    const baseGas = 100_000n; // Base transaction cost
    const swapGas = 150_000n; // Per swap
    const flashloanGas = 200_000n; // Flashloan overhead

    let gasUnits: bigint;
    if (complexity === "simple") {
      gasUnits = baseGas + 2n * swapGas; // Two swaps
    } else {
      gasUnits = baseGas + 2n * swapGas + flashloanGas; // Two swaps + flashloan
    }

    // Apply gas multiplier from config
    const multiplier = BigInt(Math.floor(this.config.arbitrage.gasMultiplier * 100));
    gasUnits = (gasUnits * multiplier) / 100n;

    // zkSync Era typical gas price (in wei)
    const gasPriceWei = BigInt(this.config.safety.maxGasPrice);

    const gasCostWei = gasUnits * gasPriceWei;

    return {
      gasUnits,
      gasPriceWei,
      gasCostWei,
    };
  }

  /**
   * Calculate flashloan fee
   * @param amount Amount borrowed
   * @param feeBps Fee in basis points (0 for SyncSwap)
   */
  calculateFlashloanFee(amount: bigint, feeBps: number = 0): bigint {
    // SyncSwap has 0 bps fee, but we support generic calculation
    return (amount * BigInt(feeBps)) / 10000n;
  }

  /**
   * Calculate net profit from arbitrage
   */
  calculateProfit(params: {
    amountIn: bigint;
    amountOut: bigint;
    flashloanFeeBps?: number;
    gasEstimate?: GasEstimate;
    ethPriceUSD?: number;
  }): ProfitEstimate {
    const {
      amountIn,
      amountOut,
      flashloanFeeBps = 0,
      gasEstimate = this.estimateGas("complex"),
      ethPriceUSD = 2000, // Default ETH price
    } = params;

    // Calculate gross profit
    const grossProfit = amountOut > amountIn ? amountOut - amountIn : 0n;

    // Calculate flashloan fee (0 for SyncSwap Vault)
    const flashloanFee = this.calculateFlashloanFee(amountIn, flashloanFeeBps);

    // Gas cost
    const gasCost = gasEstimate.gasCostWei;

    // Net profit = gross - fees - gas
    const netProfit = grossProfit > flashloanFee + gasCost 
      ? grossProfit - flashloanFee - gasCost 
      : 0n;

    // Convert to USD (assuming input token is ETH or equivalent)
    const netProfitETH = Number(netProfit) / 1e18;
    const netProfitUSD = netProfitETH * ethPriceUSD;

    // Check if profitable based on config threshold
    const isProfitable = netProfitUSD >= this.config.arbitrage.minProfitUSD;

    // Calculate profit margin
    const profitMarginPercent = amountIn > 0n 
      ? (Number(netProfit) / Number(amountIn)) * 100 
      : 0;

    return {
      grossProfit,
      flashloanFee,
      gasCost,
      netProfit,
      netProfitUSD,
      isProfitable,
      profitMarginPercent,
    };
  }

  /**
   * Validate if trade meets safety requirements
   */
  validateTrade(params: {
    profitUSD: number;
    gasPrice: bigint;
    slippage: number;
  }): { valid: boolean; reasons: string[] } {
    const reasons: string[] = [];
    let valid = true;

    // Check minimum profit
    if (params.profitUSD < this.config.arbitrage.minProfitUSD) {
      valid = false;
      reasons.push(`Profit ${params.profitUSD.toFixed(2)} USD below minimum ${this.config.arbitrage.minProfitUSD} USD`);
    }

    // Check gas price
    if (params.gasPrice > BigInt(this.config.safety.maxGasPrice)) {
      valid = false;
      reasons.push(`Gas price ${params.gasPrice} exceeds maximum ${this.config.safety.maxGasPrice}`);
    }

    // Check slippage
    if (params.slippage > this.config.arbitrage.maxSlippage) {
      valid = false;
      reasons.push(`Slippage ${(params.slippage * 100).toFixed(2)}% exceeds maximum ${(this.config.arbitrage.maxSlippage * 100).toFixed(2)}%`);
    }

    // Check dry run mode
    if (this.config.safety.dryRun) {
      valid = false;
      reasons.push("Dry run mode is enabled");
    }

    return { valid, reasons };
  }

  /**
   * Get strategy config
   */
  getConfig() {
    return this.config;
  }

  /**
   * Calculate expected daily revenue
   */
  calculateDailyRevenue(params: {
    avgProfitPerTrade: number;
    captureRate?: number;
  }): {
    totalOpportunities: number;
    capturedTrades: number;
    dailyRevenueUSD: number;
  } {
    const captureRate = params.captureRate || this.config.arbitrage.targetCaptureRate;
    const totalOpportunities = this.config.arbitrage.expectedDailyOpportunities;
    const capturedTrades = Math.floor(totalOpportunities * captureRate);
    const dailyRevenueUSD = capturedTrades * params.avgProfitPerTrade;

    return {
      totalOpportunities,
      capturedTrades,
      dailyRevenueUSD,
    };
  }
}
