/**
 * Deterministic math utilities using BigInt
 * All internal math uses BigInt to avoid floating-point precision issues
 */

/**
 * Multiply two BigInt values with a scaling factor to preserve precision
 * Result = (a * b) / scale
 */
export function mulDiv(a: bigint, b: bigint, scale: bigint): bigint {
  return (a * b) / scale;
}

/**
 * Calculate percentage in basis points (10000 = 100%)
 * Result = (value * 10000) / total
 */
export function toBasisPoints(value: bigint, total: bigint): bigint {
  if (total === 0n) return 0n;
  return (value * 10000n) / total;
}

/**
 * Convert basis points to a multiplier
 * For example, 50 bps = 0.005 = 5n / 1000n
 */
export function basisPointsToFraction(bps: bigint): { numerator: bigint; denominator: bigint } {
  return { numerator: bps, denominator: 10000n };
}

/**
 * Apply a basis point reduction to an amount
 * Result = amount * (10000 - bps) / 10000
 */
export function applyBasisPointReduction(amount: bigint, bps: bigint): bigint {
  return (amount * (10000n - bps)) / 10000n;
}

/**
 * Round down to the nearest multiple of a unit
 * Useful for computing amountOutMinimum with slippage
 */
export function roundDown(value: bigint, unit: bigint): bigint {
  return (value / unit) * unit;
}

/**
 * Format a BigInt amount to a human-readable string with decimals
 * Returns string representation for display purposes
 */
export function formatAmount(amount: bigint, decimals: number, maxDecimals: number = 6): string {
  const divisor = 10n ** BigInt(decimals);
  const wholePart = amount / divisor;
  const fractionalPart = amount % divisor;
  
  if (fractionalPart === 0n && maxDecimals === 0) {
    return wholePart.toString();
  }
  
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  const displayDecimals = Math.min(maxDecimals, decimals);
  const truncatedFractional = fractionalStr.slice(0, displayDecimals);
  
  // Pad to maxDecimals if needed
  const paddedFractional = truncatedFractional.padEnd(displayDecimals, '0');
  
  return `${wholePart}.${paddedFractional}`;
}

/**
 * Parse a decimal string to BigInt with specified decimals
 */
export function parseAmount(value: string, decimals: number): bigint {
  const [whole, fractional = ''] = value.split('.');
  const paddedFractional = fractional.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(paddedFractional);
}

/**
 * Parse human-readable amount with token symbol (e.g., "1 WETH", "2000 USDC")
 * Returns { amount: bigint, symbol: string } or null if invalid format
 */
export function parseHumanAmount(
  humanAmount: string,
  tokenInfoLookup: (symbol: string) => { decimals: number; address: string } | null
): { amount: bigint; symbol: string; decimals: number; address: string } | null {
  // Expected format: "123.45 SYMBOL" or "123 SYMBOL"
  const trimmed = humanAmount.trim();
  const parts = trimmed.split(/\s+/);
  
  if (parts.length !== 2) {
    return null;
  }
  
  const [amountStr, symbol] = parts;
  
  // Validate amount is a valid number
  if (!/^\d+(\.\d+)?$/.test(amountStr)) {
    return null;
  }
  
  // Look up token info
  const tokenInfo = tokenInfoLookup(symbol.toUpperCase());
  if (!tokenInfo) {
    return null;
  }
  
  // Parse the amount with correct decimals
  const amount = parseAmount(amountStr, tokenInfo.decimals);
  
  return {
    amount,
    symbol: symbol.toUpperCase(),
    decimals: tokenInfo.decimals,
    address: tokenInfo.address,
  };
}

/**
 * Calculate gross spread in basis points for a round-trip arbitrage
 * grossSpreadBps = ((amountOut - amountIn) / amountIn) * 10000
 * Returns signed value (can be negative when round-trip is lossy)
 */
export function calculateGrossSpreadBps(amountIn: bigint, amountOut: bigint): bigint {
  if (amountIn === 0n) return 0n;
  
  const profit = amountOut - amountIn;
  return (profit * 10000n) / amountIn;
}

/**
 * Apply slippage to an amount (reduce by slippage %)
 * For slippage = 0.005 (0.5%), use bps = 50
 */
export function applySlippage(amount: bigint, slippageBps: bigint): bigint {
  return applyBasisPointReduction(amount, slippageBps);
}

/**
 * Calculate amount with slippage tolerance for amountOutMinimum
 * Round down to ensure we don't request more than available
 */
export function calculateAmountOutMinimum(
  amountOut: bigint,
  slippageBps: bigint,
  roundingUnit: bigint = 1n
): bigint {
  const withSlippage = applySlippage(amountOut, slippageBps);
  return roundDown(withSlippage, roundingUnit);
}

/**
 * Convert token amount to another token amount using a ratio
 * Useful for USD conversion: tokenAmount * (usdcPerToken * 10^6) / 10^18
 */
export function convertAmount(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
  rate: bigint,
  rateDecimals: number
): bigint {
  // Normalize everything to the same scale
  const amountScaled = amount * (10n ** BigInt(rateDecimals));
  const result = (amountScaled * rate) / (10n ** BigInt(fromDecimals));
  
  // Scale to target decimals
  if (toDecimals > fromDecimals) {
    return result * (10n ** BigInt(toDecimals - fromDecimals));
  } else if (toDecimals < fromDecimals) {
    return result / (10n ** BigInt(fromDecimals - toDecimals));
  }
  
  return result;
}
