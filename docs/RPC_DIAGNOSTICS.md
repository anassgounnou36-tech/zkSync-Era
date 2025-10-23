# RPC Diagnostics and Verification Guide

This guide explains how to use the bot's RPC diagnostics features to ensure your RPC provider (e.g., Alchemy, Infura, QuickNode) is being used correctly and that all on-chain requests are visible in your dashboard.

## Table of Contents

1. [Overview](#overview)
2. [Configuration](#configuration)
3. [Diagnostic Commands](#diagnostic-commands)
4. [Monitoring Metrics](#monitoring-metrics)
5. [Troubleshooting](#troubleshooting)

## Overview

The bot includes comprehensive RPC diagnostics to help you:

- **Verify** which RPC endpoint is being used
- **Track** all RPC requests with detailed metrics
- **Test** connectivity and quote fetching from DEXes
- **Debug** issues with RPC configuration or network connectivity

### Key Features

- **Instrumented Provider**: All RPC requests are automatically logged and counted
- **Explicit RPC Selection**: Configure with `USE_ENV_RPC_ONLY` to ensure env variables are used
- **Runtime Override**: Use `--rpc` flag to test different endpoints without editing files
- **Request Metrics**: Track total requests, success/failure rates, and request breakdown by method
- **Debug Logging**: Set `LOG_LEVEL=debug` to see detailed logs for every RPC call

## Configuration

### Environment Variables

Edit your `.env` file to configure RPC endpoints:

```bash
# Force bot to use only environment RPC (recommended for production)
USE_ENV_RPC_ONLY=true

# Your RPC endpoints (HTTP is required, WS is optional)
ZKSYNC_RPC_HTTP=https://zksync-mainnet.g.alchemy.com/v2/YOUR_API_KEY
ZKSYNC_RPC_WS=wss://zksync-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Enable debug logging to see all RPC requests
LOG_LEVEL=debug
```

### RPC Selection Precedence

The bot selects RPC endpoints in this order:

1. **Runtime Override** (`--rpc` flag): Takes absolute precedence
2. **Environment Enforcement** (`USE_ENV_RPC_ONLY=true`): Requires `ZKSYNC_RPC_HTTP` to be set
3. **Environment Variables**: Uses `ZKSYNC_RPC_HTTP` if set
4. **Config Fallback**: Falls back to `config/dexes.json` if no env variables

### Example Configurations

#### Production (Alchemy)
```bash
USE_ENV_RPC_ONLY=true
ZKSYNC_RPC_HTTP=https://zksync-mainnet.g.alchemy.com/v2/YOUR_API_KEY
ZKSYNC_RPC_WS=wss://zksync-mainnet.g.alchemy.com/v2/YOUR_API_KEY
LOG_LEVEL=info
```

#### Development (Public RPC)
```bash
USE_ENV_RPC_ONLY=false
ZKSYNC_RPC_HTTP=https://mainnet.era.zksync.io
LOG_LEVEL=debug
```

#### Testing (Custom Provider)
```bash
USE_ENV_RPC_ONLY=true
ZKSYNC_RPC_HTTP=https://your-custom-rpc.com/v1/zksync
LOG_LEVEL=debug
```

## Diagnostic Commands

### 1. Health Check

Test basic RPC connectivity and view request metrics:

```bash
npm run cli -- diag health
```

**Output includes:**
- Network name and chain ID
- Current block number
- Current gas price
- Total RPC requests made
- Success/failure counts
- Request breakdown by method (eth_call, eth_blockNumber, etc.)
- Request breakdown by endpoint

**Example:**
```
=== RPC Health Diagnostics ===
Selected HTTP RPC: https://zksync-mainnet.g.alchemy.com/v2/...
✓ Network: zksync-era (Chain ID: 324)
✓ Current Block: 12345678
✓ Gas Price: 250000000 wei
=== RPC Request Metrics ===
Total Requests: 15
Successful: 15
Failed: 0
Average Duration: 123.45ms
Requests by Method:
  eth_chainId: 1
  eth_blockNumber: 1
  eth_feeHistory: 1
  eth_call: 12
```

### 2. Quote Testing

Fetch quotes from all enabled DEXes for configured token pairs:

```bash
npm run cli -- diag quotes
```

**Output includes:**
- RPC endpoint being used
- Token pair details (addresses, amounts)
- Quote results from each DEX
- Success/failure status with error messages
- Final RPC request count

**Example:**
```
=== DEX Quote Diagnostics ===
Using RPC: https://zksync-mainnet.g.alchemy.com/v2/...

Pair: WETH / USDC
  Amount In: 1000000000000000000 (WETH)
  Token A: 0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91
  Token B: 0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4
  DEX Quotes (WETH → USDC):
    ✓ mute: 2000123456 USDC (rate: 2000.123456)
    ✓ syncswap_v1: 2000234567 USDC (rate: 2000.234567)
    ✗ pancakeswap_v3: Pool does not exist
    
=== Quote Test Complete ===
Total RPC Requests: 45
Successful: 43
Failed: 2
```

### 3. Configuration Display

Display current DEX and token configuration:

```bash
npm run cli -- diag config
```

**Output includes:**
- Chain ID and default RPC URLs
- Enabled DEXes with router addresses and fees
- Configured tokens with addresses and decimals
- Target trading pairs

### 4. Runtime RPC Override

Test with a different RPC endpoint without editing configuration files:

```bash
# Test health with custom RPC
npm run cli -- diag health --rpc https://your-test-rpc.com

# Test quotes with custom RPC
npm run cli -- diag quotes --rpc https://your-test-rpc.com

# Run monitoring with custom RPC
npm run cli -- monitor --rpc https://your-test-rpc.com --duration 1
```

## Monitoring Metrics

### HTTP API Endpoint

Start the HTTP server to access real-time metrics:

```bash
npm run start:http
```

Then access the metrics endpoint:

```bash
curl http://localhost:3000/metrics
```

**Response format:**
```json
{
  "rpc": {
    "totalRequests": 1250,
    "successfulRequests": 1248,
    "failedRequests": 2,
    "averageDuration": 145.67,
    "byMethod": {
      "eth_blockNumber": 125,
      "eth_call": 890,
      "eth_chainId": 10,
      "eth_feeHistory": 225
    },
    "byEndpoint": {
      "https://zksync-mainnet.g.alchemy.com/v2/...": 1250
    }
  },
  "timestamp": 1698765432000
}
```

### Debug Logging

With `LOG_LEVEL=debug`, you'll see detailed logs for every operation:

**RPC Request Logs:**
```
[DEBUG] RPC request
  method: "eth_call"
  endpoint: "https://zksync-mainnet.g.alchemy.com/v2/..."
  params: [...]
  
[DEBUG] RPC request completed
  method: "eth_call"
  endpoint: "https://zksync-mainnet.g.alchemy.com/v2/..."
  duration: 123
```

**Price Quote Logs:**
```
[DEBUG] Fetching price quote
  dex: "mute"
  tokenIn: "0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91"
  tokenOut: "0x3355df6D4c9C3035724Fd0e3914dE96A5a83aaf4"
  amountIn: "1000000000000000000"
  
[DEBUG] Price quote successful
  dex: "mute"
  amountOut: "2000123456"
```

**Opportunity Evaluation Logs:**
```
[DEBUG] Evaluating arbitrage opportunity
  pair: "WETH/USDC"
  buyDex: "mute"
  sellDex: "syncswap_v1"
  spreadPercent: 0.45
  
[DEBUG] Opportunity is profitable - recording
  pair: "WETH/USDC"
  buyDex: "mute"
  sellDex: "syncswap_v1"
  spreadPercent: 0.45
  netProfitUSD: 12.34
  isProfitable: true
```

## Troubleshooting

### No Requests Showing in Dashboard

**Symptoms:** Bot runs but your Alchemy/Infura dashboard shows zero requests.

**Solutions:**

1. **Verify Configuration:**
   ```bash
   npm run cli -- diag config
   ```
   Check that the RPC URL matches your dashboard.

2. **Check Logs:**
   Set `LOG_LEVEL=debug` and look for:
   ```
   "Using RPC from environment (USE_ENV_RPC_ONLY=true)"
   "Creating instrumented provider..."
   "RPC request" logs
   ```

3. **Test Connectivity:**
   ```bash
   npm run cli -- diag health
   ```
   If this fails, check your API key and network connectivity.

4. **Verify URL:**
   Make sure `ZKSYNC_RPC_HTTP` exactly matches your provider's URL:
   ```bash
   # Correct for Alchemy
   ZKSYNC_RPC_HTTP=https://zksync-mainnet.g.alchemy.com/v2/YOUR_API_KEY
   
   # NOT (missing /v2/)
   ZKSYNC_RPC_HTTP=https://zksync-mainnet.g.alchemy.com/YOUR_API_KEY
   ```

### Requests Failing

**Symptoms:** `diag health` or `diag quotes` show failed requests.

**Solutions:**

1. **Check Rate Limits:**
   Your RPC provider may have rate limits. Check your dashboard for throttling.

2. **Verify Network:**
   Ensure you're using a zkSync Era endpoint, not Ethereum mainnet.

3. **Check Logs:**
   Look for error messages in debug logs:
   ```bash
   LOG_LEVEL=debug npm run cli -- diag health
   ```

4. **Test Different Endpoint:**
   Try the public endpoint to verify your setup:
   ```bash
   npm run cli -- diag health --rpc https://mainnet.era.zksync.io
   ```

### Using Wrong RPC

**Symptoms:** Requests appear in the wrong dashboard or config file RPC is used.

**Solutions:**

1. **Enforce Environment RPC:**
   ```bash
   USE_ENV_RPC_ONLY=true
   ZKSYNC_RPC_HTTP=https://your-correct-rpc.com
   ```
   If `ZKSYNC_RPC_HTTP` is not set, the bot will error immediately.

2. **Check Startup Logs:**
   Look for the RPC selection message:
   ```
   "Using RPC from environment (USE_ENV_RPC_ONLY=true)"
   httpUrl: "https://your-rpc.com"
   ```

3. **Verify Metrics Endpoint:**
   Check `/metrics` to see which endpoint is receiving requests:
   ```bash
   curl http://localhost:3000/metrics | jq '.rpc.byEndpoint'
   ```

### High Request Count

**Symptoms:** More requests than expected in your dashboard.

**Explanation:** The bot makes multiple RPC calls per operation:
- Each DEX quote may require 2-3 calls (pool lookup, quote)
- Monitoring polls every 60 seconds
- Each scan checks multiple token pairs across all DEXes

**Expected Rates:**
- **Monitoring (3 pairs, 4 DEXes):** ~50-100 requests/minute
- **Quote Test:** ~10-30 requests per run
- **Health Check:** ~3 requests per run

## Best Practices

1. **Production Setup:**
   - Always use `USE_ENV_RPC_ONLY=true`
   - Use dedicated RPC endpoint for each environment
   - Set `LOG_LEVEL=info` (not debug) in production

2. **Testing:**
   - Use `--rpc` flag for quick tests
   - Use debug logging to understand behavior
   - Run `diag health` before starting long-running monitors

3. **Monitoring:**
   - Check `/metrics` endpoint periodically
   - Monitor your RPC provider dashboard for rate limits
   - Watch for failed requests in logs

4. **Security:**
   - Never commit `.env` files with real API keys
   - Use `.env.example` as template
   - Rotate API keys periodically
