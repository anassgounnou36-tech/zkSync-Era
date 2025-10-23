import { JsonRpcProvider } from "ethers";
import { loadConfig } from "../config/config.js";
import { logger } from "../config/logger.js";
import { metricsTracker } from "../monitoring/metrics.js";
import dexesConfig from "../../config/dexes.json" assert { type: "json" };

/**
 * Instrumented JSON-RPC provider that tracks all requests
 */
class InstrumentedProvider extends JsonRpcProvider {
  private endpoint: string;

  constructor(url: string) {
    super(url);
    this.endpoint = this.getBaseUrl(url);
  }

  /**
   * Extract base URL without query params or API keys for logging
   */
  private getBaseUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
    } catch {
      return url;
    }
  }

  /**
   * Override send to track all RPC requests
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async send(method: string, params: Array<any>): Promise<any> {
    const startTime = Date.now();
    
    logger.debug({ method, endpoint: this.endpoint, params }, "RPC request");

    try {
      const result = await super.send(method, params);
      const duration = Date.now() - startTime;

      metricsTracker.recordRequest({
        method,
        endpoint: this.endpoint,
        timestamp: startTime,
        duration,
        success: true,
      });

      logger.debug(
        { method, endpoint: this.endpoint, duration },
        "RPC request completed"
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      metricsTracker.recordRequest({
        method,
        endpoint: this.endpoint,
        timestamp: startTime,
        duration,
        success: false,
        error: errorMessage,
      });

      logger.debug(
        { method, endpoint: this.endpoint, duration, error: errorMessage },
        "RPC request failed"
      );

      throw error;
    }
  }
}

export interface ProviderConfig {
  httpUrl: string;
  wsUrl?: string;
}

/**
 * Get RPC URLs from environment variables (ENV-only approach)
 * Precedence:
 * 1. Runtime override (for diag commands only)
 * 2. ZKSYNC_RPC_HTTP from environment (REQUIRED)
 * 
 * No fallback to config files - RPC must always be provided via environment.
 */
function getRpcUrls(runtimeOverride?: string): ProviderConfig {
  // Runtime override takes absolute precedence (for CLI diag testing only)
  if (runtimeOverride) {
    logger.info({ rpcUrl: runtimeOverride }, "Using runtime RPC override (diag mode)");
    return { httpUrl: runtimeOverride };
  }

  // Require ZKSYNC_RPC_HTTP from environment
  const httpUrl = process.env.ZKSYNC_RPC_HTTP;
  const wsUrl = process.env.ZKSYNC_RPC_WS;

  if (!httpUrl) {
    throw new Error(
      "ZKSYNC_RPC_HTTP must be set in environment variables. " +
      "Set it to your RPC endpoint (e.g., Alchemy, Infura, or public RPC). " +
      "No config fallback is supported."
    );
  }

  logger.info(
    { httpUrl, wsUrl: wsUrl || "not set" },
    "Using RPC from environment variables"
  );

  return {
    httpUrl,
    wsUrl,
  };
}

/**
 * Create an instrumented provider with the selected RPC endpoint
 */
export function createProvider(runtimeOverride?: string): InstrumentedProvider {
  const { httpUrl } = getRpcUrls(runtimeOverride);
  
  logger.info(
    { endpoint: httpUrl },
    "Creating instrumented provider - all RPC requests will be tracked"
  );

  return new InstrumentedProvider(httpUrl);
}

/**
 * Get the selected RPC URLs for display purposes
 */
export function getSelectedRpcUrls(runtimeOverride?: string): ProviderConfig {
  return getRpcUrls(runtimeOverride);
}
