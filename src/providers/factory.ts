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
 * Get RPC URLs based on configuration precedence
 * Precedence:
 * 1. If USE_ENV_RPC_ONLY=true, always use ZKSYNC_RPC_HTTP/WS (error if not set)
 * 2. If ZKSYNC_RPC_HTTP/WS are set, use them
 * 3. Fall back to config/dexes.json
 * 4. Runtime override takes precedence over all
 */
function getRpcUrls(runtimeOverride?: string): ProviderConfig {
  const config = loadConfig();

  // Runtime override takes absolute precedence
  if (runtimeOverride) {
    logger.info({ rpcUrl: runtimeOverride }, "Using runtime RPC override");
    return { httpUrl: runtimeOverride };
  }

  // If USE_ENV_RPC_ONLY is true, require env variables
  if (config.useEnvRpcOnly) {
    if (!config.zkSyncRpcHttp) {
      throw new Error(
        "USE_ENV_RPC_ONLY is true but ZKSYNC_RPC_HTTP is not set in environment"
      );
    }
    logger.info(
      { httpUrl: config.zkSyncRpcHttp, wsUrl: config.zkSyncRpcWs },
      "Using RPC from environment (USE_ENV_RPC_ONLY=true)"
    );
    return {
      httpUrl: config.zkSyncRpcHttp,
      wsUrl: config.zkSyncRpcWs,
    };
  }

  // Prefer env variables if available
  if (config.zkSyncRpcHttp) {
    logger.info(
      { httpUrl: config.zkSyncRpcHttp, wsUrl: config.zkSyncRpcWs },
      "Using RPC from environment variables"
    );
    return {
      httpUrl: config.zkSyncRpcHttp,
      wsUrl: config.zkSyncRpcWs,
    };
  }

  // Fall back to legacy config or dexes.json
  if (config.zkSyncRpcUrl && config.zkSyncRpcUrl !== "https://mainnet.era.zksync.io") {
    logger.info(
      { httpUrl: config.zkSyncRpcUrl },
      "Using RPC from ZKSYNC_ERA_RPC_URL"
    );
    return { httpUrl: config.zkSyncRpcUrl };
  }

  // Final fallback to dexes.json
  const dexConfig = dexesConfig.zkSyncEra;
  logger.info(
    { httpUrl: dexConfig.rpcUrl, wsUrl: dexConfig.wsUrl },
    "Using RPC from config/dexes.json (fallback)"
  );
  return {
    httpUrl: dexConfig.rpcUrl,
    wsUrl: dexConfig.wsUrl,
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
