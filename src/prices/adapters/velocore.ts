import { JsonRpcProvider, Contract } from "ethers";
import { logger } from "../../config/logger.js";

/**
 * Velocore Quote Result
 */
export interface VelocoreQuoteResult {
  success: boolean;
  amountOut: bigint;
  error?: string;
}

// Velocore Pool ABI (simplified for read-only quoting)
const VELOCORE_POOL_ABI = [
  "function getAmountOut(uint256 amountIn, address tokenIn, address tokenOut) external view returns (uint256)",
  "function querySwap(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256)",
];

/**
 * Velocore read-only quoting adapter
 * This adapter is DISABLED by default for safety
 * If enabled, it must not throw; skip on error
 */
export async function getVelocoreQuote(
  provider: JsonRpcProvider,
  poolAddress: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  options: {
    verbose?: boolean;
  } = {}
): Promise<VelocoreQuoteResult> {
  const { verbose = false } = options;

  if (verbose) {
    logger.debug(
      { poolAddress, tokenIn, tokenOut, amountIn: amountIn.toString() },
      "Starting Velocore quote"
    );
  }

  // Try different quote methods
  const pool = new Contract(poolAddress, VELOCORE_POOL_ABI, provider);

  // Method 1: getAmountOut
  try {
    const amountOut = await pool.getAmountOut(amountIn, tokenIn, tokenOut);
    if (verbose) {
      logger.debug(
        { poolAddress, amountOut: amountOut.toString(), method: "getAmountOut" },
        "Velocore quote successful"
      );
    }
    return {
      success: true,
      amountOut: BigInt(amountOut.toString()),
    };
  } catch (error) {
    if (verbose) {
      logger.debug(
        { poolAddress, error: error instanceof Error ? error.message : "Unknown", method: "getAmountOut" },
        "Velocore getAmountOut failed"
      );
    }
  }

  // Method 2: querySwap
  try {
    const amountOut = await pool.querySwap(tokenIn, tokenOut, amountIn);
    if (verbose) {
      logger.debug(
        { poolAddress, amountOut: amountOut.toString(), method: "querySwap" },
        "Velocore quote successful"
      );
    }
    return {
      success: true,
      amountOut: BigInt(amountOut.toString()),
    };
  } catch (error) {
    if (verbose) {
      logger.debug(
        { poolAddress, error: error instanceof Error ? error.message : "Unknown", method: "querySwap" },
        "Velocore querySwap failed"
      );
    }
  }

  // All methods failed
  return {
    success: false,
    amountOut: 0n,
    error: "All Velocore quote methods failed",
  };
}
