import { JsonRpcProvider, Contract, Interface } from "ethers";
import { logger } from "../../config/logger.js";

// Factory ABIs for pool discovery
const CLASSIC_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB) external view returns (address pool)",
];

const STABLE_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB) external view returns (address pool)",
];

// Multiple quote ABIs to probe
const QUOTE_ABI_A = [
  "function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256)",
];

const QUOTE_ABI_B = [
  "function getAmountOut(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256)",
];

// ABIs for reading pool state for off-chain calculations
const POOL_STATE_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint256 reserve0, uint256 reserve1)",
  "function reserves() external view returns (uint256 reserve0, uint256 reserve1)",
  "function reserve0() external view returns (uint256)",
  "function reserve1() external view returns (uint256)",
  "function fee() external view returns (uint256)",
  "function getFee() external view returns (uint256)",
  "function feeBasisPoints() external view returns (uint256)",
];

export interface SyncSwapQuoteResult {
  success: boolean;
  amountOut: bigint;
  poolAddress?: string;
  poolType?: "classic" | "stable";
  method?: string;
  error?: string;
  disabled?: boolean;
}

interface PoolState {
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
  fee: bigint; // in basis points (e.g., 30 = 0.3%)
}

// In-memory error counter for auto-disable
const errorCounters = new Map<string, number>();
const disabledPairs = new Set<string>();
const MAX_CONSECUTIVE_ERRORS = 5;

// Factory addresses
const CLASSIC_FACTORY = "0xf2DAd89f2788a8CD54625C60b55cD3d2D0ACa7Cb";
const STABLE_FACTORY = "0x5b9f21d407F35b10CbfDDca17D5D84b129356ea3";

// Stable symbols for preferring stable pools
const STABLE_SYMBOLS = ["USDC", "USDT"];

/**
 * Check if a pair is disabled due to repeated failures
 */
function isPairDisabled(tokenIn: string, tokenOut: string): boolean {
  const pairKey = `${tokenIn.toLowerCase()}-${tokenOut.toLowerCase()}`;
  return disabledPairs.has(pairKey);
}

/**
 * Increment error counter and disable pair if threshold reached
 */
function recordError(tokenIn: string, tokenOut: string): void {
  const pairKey = `${tokenIn.toLowerCase()}-${tokenOut.toLowerCase()}`;
  const currentCount = errorCounters.get(pairKey) || 0;
  const newCount = currentCount + 1;
  errorCounters.set(pairKey, newCount);

  if (newCount >= MAX_CONSECUTIVE_ERRORS) {
    disabledPairs.add(pairKey);
    logger.warn(
      {
        tokenIn,
        tokenOut,
        consecutiveErrors: newCount,
        threshold: MAX_CONSECUTIVE_ERRORS,
      },
      "SyncSwap quoting disabled for this pair due to repeated failures"
    );
  }
}

/**
 * Reset error counter on successful quote
 */
function recordSuccess(tokenIn: string, tokenOut: string): void {
  const pairKey = `${tokenIn.toLowerCase()}-${tokenOut.toLowerCase()}`;
  errorCounters.delete(pairKey);
}

/**
 * Check if tokens represent a stable pair
 */
function isStablePair(tokenInSymbol: string, tokenOutSymbol: string): boolean {
  return (
    STABLE_SYMBOLS.includes(tokenInSymbol) &&
    STABLE_SYMBOLS.includes(tokenOutSymbol)
  );
}

/**
 * Discover pools from factories
 */
async function discoverPools(
  provider: JsonRpcProvider,
  tokenIn: string,
  tokenOut: string,
  verbose: boolean
): Promise<{ classic: string; stable: string }> {
  const results = { classic: "", stable: "" };

  // Query Classic factory
  try {
    const classicFactory = new Contract(
      CLASSIC_FACTORY,
      CLASSIC_FACTORY_ABI,
      provider
    );
    const classicPool = await classicFactory.getPool(tokenIn, tokenOut);
    if (
      classicPool &&
      classicPool !== "0x0000000000000000000000000000000000000000"
    ) {
      results.classic = classicPool;
      if (verbose) {
        logger.debug(
          { factory: CLASSIC_FACTORY, pool: classicPool },
          "Found Classic pool"
        );
      }
    }
  } catch (error) {
    if (verbose) {
      logger.debug(
        { factory: CLASSIC_FACTORY, error: error instanceof Error ? error.message : "Unknown" },
        "Classic factory query failed"
      );
    }
  }

  // Query Stable factory
  try {
    const stableFactory = new Contract(
      STABLE_FACTORY,
      STABLE_FACTORY_ABI,
      provider
    );
    const stablePool = await stableFactory.getPool(tokenIn, tokenOut);
    if (
      stablePool &&
      stablePool !== "0x0000000000000000000000000000000000000000"
    ) {
      results.stable = stablePool;
      if (verbose) {
        logger.debug(
          { factory: STABLE_FACTORY, pool: stablePool },
          "Found Stable pool"
        );
      }
    }
  } catch (error) {
    if (verbose) {
      logger.debug(
        { factory: STABLE_FACTORY, error: error instanceof Error ? error.message : "Unknown" },
        "Stable factory query failed"
      );
    }
  }

  return results;
}

/**
 * Probe multiple quote ABIs safely
 */
async function probeQuoteABIs(
  provider: JsonRpcProvider,
  poolAddress: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  verbose: boolean
): Promise<{ success: boolean; amountOut: bigint; method?: string }> {
  // Try ABI A: getAmountOut(uint256 amountIn, address tokenIn)
  try {
    const contract = new Contract(poolAddress, QUOTE_ABI_A, provider);
    const result = await contract.getAmountOut.staticCall(amountIn, tokenIn);
    const amountOut = BigInt(result.toString());
    if (verbose) {
      logger.debug(
        { poolAddress, method: "getAmountOut(uint256,address)", amountOut: amountOut.toString() },
        "ABI A successful"
      );
    }
    return { success: true, amountOut, method: "ABI_A" };
  } catch (error) {
    if (verbose) {
      logger.debug(
        { poolAddress, method: "getAmountOut(uint256,address)", error: error instanceof Error ? error.message : "Unknown" },
        "ABI A failed"
      );
    }
  }

  // Try ABI B: getAmountOut(address tokenIn, address tokenOut, uint256 amountIn)
  try {
    const contract = new Contract(poolAddress, QUOTE_ABI_B, provider);
    const result = await contract.getAmountOut.staticCall(
      tokenIn,
      tokenOut,
      amountIn
    );
    const amountOut = BigInt(result.toString());
    if (verbose) {
      logger.debug(
        { poolAddress, method: "getAmountOut(address,address,uint256)", amountOut: amountOut.toString() },
        "ABI B successful"
      );
    }
    return { success: true, amountOut, method: "ABI_B" };
  } catch (error) {
    if (verbose) {
      logger.debug(
        { poolAddress, method: "getAmountOut(address,address,uint256)", error: error instanceof Error ? error.message : "Unknown" },
        "ABI B failed"
      );
    }
  }

  return { success: false, amountOut: 0n };
}

/**
 * Read pool state for off-chain calculation
 */
async function readPoolState(
  provider: JsonRpcProvider,
  poolAddress: string,
  verbose: boolean
): Promise<PoolState | null> {
  const contract = new Contract(poolAddress, POOL_STATE_ABI, provider);
  const state: Partial<PoolState> = {};

  try {
    // Read token0 and token1
    try {
      state.token0 = await contract.token0();
      state.token1 = await contract.token1();
    } catch (error) {
      if (verbose) {
        logger.debug({ poolAddress, error: error instanceof Error ? error.message : "Unknown" }, "Failed to read tokens");
      }
      return null;
    }

    // Try different reserve functions
    let reservesRead = false;
    try {
      const reserves = await contract.getReserves();
      state.reserve0 = BigInt(reserves[0].toString());
      state.reserve1 = BigInt(reserves[1].toString());
      reservesRead = true;
    } catch {
      // Try alternative
      try {
        const reserves = await contract.reserves();
        state.reserve0 = BigInt(reserves[0].toString());
        state.reserve1 = BigInt(reserves[1].toString());
        reservesRead = true;
      } catch {
        // Try individual getters
        try {
          state.reserve0 = BigInt((await contract.reserve0()).toString());
          state.reserve1 = BigInt((await contract.reserve1()).toString());
          reservesRead = true;
        } catch (error) {
          if (verbose) {
            logger.debug({ poolAddress, error: error instanceof Error ? error.message : "Unknown" }, "Failed to read reserves");
          }
        }
      }
    }

    if (!reservesRead) {
      return null;
    }

    // Try different fee functions (default to 30 basis points if not found)
    try {
      state.fee = BigInt((await contract.fee()).toString());
    } catch {
      try {
        state.fee = BigInt((await contract.getFee()).toString());
      } catch {
        try {
          state.fee = BigInt((await contract.feeBasisPoints()).toString());
        } catch {
          // Default to 0.3% (30 basis points)
          state.fee = 30n;
          if (verbose) {
            logger.debug({ poolAddress }, "Using default fee of 30 basis points");
          }
        }
      }
    }

    if (
      state.token0 &&
      state.token1 &&
      state.reserve0 !== undefined &&
      state.reserve1 !== undefined &&
      state.fee !== undefined
    ) {
      return state as PoolState;
    }
  } catch (error) {
    if (verbose) {
      logger.debug(
        { poolAddress, error: error instanceof Error ? error.message : "Unknown" },
        "Failed to read pool state"
      );
    }
  }

  return null;
}

/**
 * Calculate quote using constant-product formula with fee
 */
function calculateConstantProductQuote(
  state: PoolState,
  tokenIn: string,
  amountIn: bigint
): bigint {
  // Determine which reserve is for tokenIn
  const isToken0 =
    tokenIn.toLowerCase() === state.token0.toLowerCase();
  const reserveIn = isToken0 ? state.reserve0 : state.reserve1;
  const reserveOut = isToken0 ? state.reserve1 : state.reserve0;

  // Apply fee: amountInAfterFee = amountIn * (10000 - feeBps) / 10000
  const feeBps = state.fee;
  const amountInAfterFee = (amountIn * (10000n - feeBps)) / 10000n;

  // Constant product: amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee)
  const amountOut =
    (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);

  return amountOut;
}

/**
 * Main SyncSwap quote engine
 */
export async function getSyncSwapQuote(
  provider: JsonRpcProvider,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  options: {
    tokenInSymbol?: string;
    tokenOutSymbol?: string;
    verbose?: boolean;
  } = {}
): Promise<SyncSwapQuoteResult> {
  const { tokenInSymbol, tokenOutSymbol, verbose = false } = options;

  // Check if pair is disabled
  if (isPairDisabled(tokenIn, tokenOut)) {
    return {
      success: false,
      amountOut: 0n,
      disabled: true,
      error: `SyncSwap disabled for this pair after ${MAX_CONSECUTIVE_ERRORS} consecutive failures`,
    };
  }

  if (verbose) {
    logger.debug(
      { tokenIn, tokenOut, amountIn: amountIn.toString() },
      "Starting SyncSwap quote"
    );
  }

  // Discover pools
  const pools = await discoverPools(provider, tokenIn, tokenOut, verbose);

  if (!pools.classic && !pools.stable) {
    if (verbose) {
      logger.debug({ tokenIn, tokenOut }, "No pools found in any factory");
    }
    recordError(tokenIn, tokenOut);
    return {
      success: false,
      amountOut: 0n,
      error: "No pools found",
    };
  }

  // Select pool (prefer stable for stable pairs)
  let selectedPool: string;
  let poolType: "classic" | "stable";
  
  if (
    pools.stable &&
    tokenInSymbol &&
    tokenOutSymbol &&
    isStablePair(tokenInSymbol, tokenOutSymbol)
  ) {
    selectedPool = pools.stable;
    poolType = "stable";
  } else if (pools.classic) {
    selectedPool = pools.classic;
    poolType = "classic";
  } else {
    selectedPool = pools.stable;
    poolType = "stable";
  }

  if (verbose) {
    logger.debug(
      { selectedPool, poolType, factories: { classic: pools.classic, stable: pools.stable } },
      "Selected pool"
    );
  }

  // Probe quote ABIs
  const quoteResult = await probeQuoteABIs(
    provider,
    selectedPool,
    tokenIn,
    tokenOut,
    amountIn,
    verbose
  );

  if (quoteResult.success) {
    recordSuccess(tokenIn, tokenOut);
    return {
      success: true,
      amountOut: quoteResult.amountOut,
      poolAddress: selectedPool,
      poolType,
      method: quoteResult.method,
    };
  }

  // Both ABIs failed, try off-chain calculation for classic pools
  if (poolType === "classic") {
    if (verbose) {
      logger.debug(
        { poolAddress: selectedPool },
        "Attempting off-chain calculation for Classic pool"
      );
    }

    const poolState = await readPoolState(provider, selectedPool, verbose);
    if (poolState) {
      try {
        const amountOut = calculateConstantProductQuote(
          poolState,
          tokenIn,
          amountIn
        );
        
        if (verbose) {
          logger.debug(
            { poolAddress: selectedPool, amountOut: amountOut.toString(), method: "off-chain" },
            "Off-chain calculation successful"
          );
        }

        recordSuccess(tokenIn, tokenOut);
        return {
          success: true,
          amountOut,
          poolAddress: selectedPool,
          poolType,
          method: "off-chain-classic",
        };
      } catch (error) {
        if (verbose) {
          logger.debug(
            { poolAddress: selectedPool, error: error instanceof Error ? error.message : "Unknown" },
            "Off-chain calculation failed"
          );
        }
      }
    } else {
      if (verbose) {
        logger.debug(
          { poolAddress: selectedPool },
          "Could not read pool state for off-chain calculation"
        );
      }
    }
  } else {
    // Stable pool - skip off-chain calculation
    if (verbose) {
      logger.debug(
        { poolAddress: selectedPool, poolType },
        "Skipping off-chain calculation for Stable pool (requires stable invariant math)"
      );
    }
  }

  // All methods failed
  recordError(tokenIn, tokenOut);
  return {
    success: false,
    amountOut: 0n,
    poolAddress: selectedPool,
    poolType,
    error: "All quote methods failed",
  };
}

/**
 * Get diagnostics about SyncSwap state
 */
export function getSyncSwapDiagnostics(): {
  errorCounters: Map<string, number>;
  disabledPairs: Set<string>;
  maxErrors: number;
} {
  return {
    errorCounters: new Map(errorCounters),
    disabledPairs: new Set(disabledPairs),
    maxErrors: MAX_CONSECUTIVE_ERRORS,
  };
}

/**
 * Reset SyncSwap state (for testing)
 */
export function resetSyncSwapState(): void {
  errorCounters.clear();
  disabledPairs.clear();
}
