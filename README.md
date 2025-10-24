# zkSync Era Flashloan Arbitrage Bot

Production-grade, modular arbitrage bot for zkSync Era with flashloans, upgradable contracts, orchestration (monitor/simulate/execute), analytics, CI, and docs. This repo implements the spec in [tttttt.txt](./tttttt.txt).

## Quick start

1. Prereqs: Node 20+, npm, Docker (optional)
2. Install:

```bash
npm install
```

3. Copy env and configs:

```bash
cp .env.example .env
```

Edit `.env` to set your RPC endpoints and other configuration.

4. Build, lint, test:

```bash
npm run build
npm run lint
npm run test
```

5. Run local dev (dry-run):

```bash
npm run simulate
npm run monitor -- --dry-run
```

6. HTTP API or CLI:

```bash
npm run start:http
npm run start:cli
```

See docs/GETTING_STARTED.md and docs/DEPLOYMENT.md for details.

## RPC Selection: Environment-Only

The bot exclusively uses RPC endpoints from environment variables. There is no fallback to config files - `ZKSYNC_RPC_HTTP` must be set or the bot will fail to start.

### 1. Configure Environment Variables

Edit your `.env` file:

```bash
# Your Alchemy or custom RPC endpoint (REQUIRED)
ZKSYNC_RPC_HTTP=https://zksync-mainnet.g.alchemy.com/v2/YOUR_API_KEY
ZKSYNC_RPC_WS=wss://zksync-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Enable debug logging to see all RPC requests
LOG_LEVEL=debug
```

**Important**: 
- `ZKSYNC_RPC_HTTP` is **required** and must be set in your environment
- `ZKSYNC_RPC_WS` is optional (WebSocket endpoint)
- No fallback to config files exists - if `ZKSYNC_RPC_HTTP` is not set, the bot will throw a clear error
- All CLI commands (monitor, execute, etc.) use environment RPC exclusively

### 2. Run Diagnostic Commands

Test RPC connectivity and view metrics:

```bash
# Basic health check - tests RPC calls and displays metrics
npm run cli -- diag health

# Test quotes from all DEXes for configured pairs
npm run cli -- diag quotes

# Test with custom amount (in wei)
npm run cli -- diag quotes --amount 1000000000000000000

# Filter quotes by specific DEX
npm run cli -- diag quotes --dex pancakeswap_v3

# Override RPC for testing (diag commands only)
npm run cli -- diag health --rpc https://custom-rpc.example.com

# Display current configuration
npm run cli -- diag config
```

### 3. Verify in Your Dashboard

After running the diagnostic commands:

1. Check your Alchemy dashboard at https://dashboard.alchemy.com
2. You should see requests appearing under your zkSync Era app
3. Look for methods like `eth_chainId`, `eth_blockNumber`, `eth_call`, etc.

The diagnostic commands will show:
- Which RPC endpoint is being used
- Total number of requests made
- Success/failure counts
- Request breakdown by method

### 4. Monitor Runtime Metrics

Start the HTTP API server to access real-time metrics:

```bash
npm run start:http
```

Then visit http://localhost:3000/metrics to see:
- Total RPC requests
- Requests by method (eth_call, eth_blockNumber, etc.)
- Requests by endpoint
- Success/failure rates

### 5. RPC Override (Testing Only)

The `--rpc` flag is only available for diagnostic commands and is intended for testing different endpoints:

```bash
# Test with custom RPC (diag commands only)
npm run cli -- diag health --rpc https://your-custom-rpc.com
npm run cli -- diag quotes --rpc https://your-custom-rpc.com
```

**Note**: `monitor` and `execute` commands always use environment RPC (`ZKSYNC_RPC_HTTP`) and do not support `--rpc` override.

### Troubleshooting

If you don't see requests in your dashboard:

1. **Check logs**: With `LOG_LEVEL=debug`, you should see messages like:
   ```
   "Using RPC from environment variables"
   "Creating instrumented provider - all RPC requests will be tracked"
   "RPC request" with method and endpoint details
   ```

2. **Verify environment**: Ensure `ZKSYNC_RPC_HTTP` is set correctly in your `.env` file

3. **Test connectivity**: Run `npm run cli -- diag health` to ensure basic RPC calls succeed

4. **Check metrics**: If requests are being made but not showing in dashboard, verify the endpoint URL matches exactly

5. **Missing ZKSYNC_RPC_HTTP**: If you see an error like "ZKSYNC_RPC_HTTP must be set in environment variables", add it to your `.env` file

## Configuration

The bot uses two main configuration files:

- **config/dexes.json** - DEX addresses, token addresses, and flashloan provider settings for zkSync Era mainnet
- **config/strategy.json** - Arbitrage strategy parameters including minimum profit thresholds, gas limits, and safety settings

**RPC Configuration**: The bot exclusively uses RPC endpoints from environment variables (`.env` file). `ZKSYNC_RPC_HTTP` is required for all operations.

See [Perplexity AI message.txt](./Perplexity%20AI%20message.txt) for the full implementation proposal and specifications.

## New CLI Commands

The bot now includes comprehensive monitoring and execution capabilities:

### Monitor Price Gaps

```bash
# Monitor for 2 hours
npm run cli -- monitor --duration 2

# Monitor for default 48 hours
npm run cli -- monitor
```

Continuously scans configured token pairs, tracks arbitrage opportunities in SQLite with lifecycle tracking (open/closed), computes decay times, and generates hourly statistics.

### Execute Arbitrage

```bash
# Dry run mode (recommended for testing)
npm run cli -- execute --dry-run

# Live execution (requires wallet and contract setup)
npm run cli -- execute --interval 60
```

Automated execution orchestrator that reads opportunities, validates against safety gates (min profit, max gas, slippage), and triggers flashloan-based trades.

### Generate Reports

```bash
npm run cli -- report
```

Generates `monitoring-report.json` with aggregated statistics including opportunity counts, decay times, hourly breakdowns, and top opportunities.

### View Configuration

```bash
npm run cli -- info
```

Displays current bot configuration including enabled DEXes, RPC endpoints, and thresholds.

## Highlights

- Upgradable contracts (UUPS), roles (admin, pauser, executor, strategist, withdrawer)
- **SyncSwap Vault** flashloan integration with multi-token support (0% fee)
- **DEX Integration**: 
  - Mute.io with automatic stable-pair detection (USDC/USDT uses stable=true)
  - SyncSwap V1 price fetching via PoolMaster->getPool + Router->getAmountOut
  - PancakeSwap V3 reliable quotes via Quoter V2 contract (0x3d146FcE6c1006857750cBe8aF44f76a28041CCc)
- Arbitrage executor with token/pool whitelists, slippage guard, SafeERC20
- Flashloan router with `executeFlashloanMulti(tokens[], amounts[], data)` and `receiveFlashLoan` callback
- **Live price fetching** from DEXes with graceful error handling
- **Profit calculator** with gas cost modeling and profitability validation
- **Continuous monitoring** with SQLite persistence, opportunity lifecycle tracking, and decay time computation
- **Execution orchestrator** with safety gates, dry-run mode, and flashloan integration
- Off-chain orchestration: mempool monitor, price/route builder, simulator, submitter
- Telegram alerts + manual commands (pause/resume/kill/status)
- Analytics DB + PnL reports
- CI: build, lint, test (integration tests require `ZKSYNC_LIVE_TESTS=1`); Security: slither (non-blocking)

## Status

- **Production-ready SyncSwap Vault flashloan integration** with real mainnet addresses
- **Live DEX price fetching** from Mute.io, SyncSwap V1, and PancakeSwap V3 (best-effort)
- **Supported DEXes**: Mute.io, SyncSwap V1/V2, PancakeSwap V3
  - DEX addresses configured in `config/dexes.json`
  - Flashloan router and arbitrage executor addresses in `config/contracts.json` (config-driven deployment)
- **Profit modeling** with gas cost estimation and USD conversion
- **Continuous price gap monitoring** with SQLite persistence and lifecycle tracking
- **Execution orchestrator** with safety gates and flashloan integration
- **Comprehensive CLI** for monitoring, execution, and reporting
- End-to-end dry-run with mocks and placeholder addresses
- zkSync Era mainnet-ready configuration with safety parameters
- Integration tests guarded by environment flag to keep CI green
- All tests passing; TypeScript and Solidity compile successfully
