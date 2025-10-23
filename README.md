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

## Verify Your RPC is Used

To ensure your bot is using the correct RPC endpoint (e.g., Alchemy) and that requests are visible in your dashboard:

### 1. Configure Environment Variables

Edit your `.env` file:

```bash
# Force bot to use only environment RPC (no fallback to config files)
USE_ENV_RPC_ONLY=true

# Your Alchemy or custom RPC endpoint
ZKSYNC_RPC_HTTP=https://zksync-mainnet.g.alchemy.com/v2/YOUR_API_KEY
ZKSYNC_RPC_WS=wss://zksync-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Enable debug logging to see all RPC requests
LOG_LEVEL=debug
```

### 2. Run Diagnostic Commands

Test RPC connectivity and view metrics:

```bash
# Basic health check - tests RPC calls and displays metrics
npm run cli -- diag health

# Test quotes from all DEXes for configured pairs
npm run cli -- diag quotes

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

### 5. Override RPC at Runtime

You can override the RPC endpoint for any command without editing files:

```bash
# Use custom RPC for monitoring
npm run cli -- monitor --rpc https://your-custom-rpc.com

# Use custom RPC for diagnostics
npm run cli -- diag health --rpc https://your-custom-rpc.com

# Use custom RPC for quote testing
npm run cli -- diag quotes --rpc https://your-custom-rpc.com
```

### Troubleshooting

If you don't see requests in your dashboard:

1. **Check logs**: With `LOG_LEVEL=debug`, you should see messages like:
   ```
   "Using RPC from environment (USE_ENV_RPC_ONLY=true)"
   "Creating instrumented provider - all RPC requests will be tracked"
   "RPC request" with method and endpoint details
   ```

2. **Verify configuration**: Run `npm run cli -- diag config` to see which endpoints are configured

3. **Test connectivity**: Run `npm run cli -- diag health` to ensure basic RPC calls succeed

4. **Check metrics**: If requests are being made but not showing in dashboard, verify the endpoint URL matches exactly

## Configuration

The bot uses two main configuration files:

- **config/dexes.json** - DEX addresses, token addresses, and flashloan provider settings for zkSync Era mainnet
- **config/strategy.json** - Arbitrage strategy parameters including minimum profit thresholds, gas limits, and safety settings

Environment variables in `.env` take precedence over config files when `USE_ENV_RPC_ONLY=true`.

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
  - Mute.io swap support
  - SyncSwap V1 price fetching via PoolMaster->getPool + Router->getAmountOut
  - PancakeSwap V3 price quotes via Smart Router and swap execution via exactInputSingle
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
