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
# Shows realistic multi-hop routes (e.g., WETH→USDC→USDT for PancakeSwap V3)
npm run cli -- diag quotes

# Test with custom amount (in wei)
npm run cli -- diag quotes --amount 1000000000000000000

# Test with human-readable amount - NEW!
npm run cli -- diag quotes --amount-human "1 WETH"
npm run cli -- diag quotes --amount-human "2000 USDC"

# Filter quotes by specific DEX
npm run cli -- diag quotes --dex pancakeswap_v3

# Filter by specific pair
npm run cli -- diag quotes --pair USDC/USDT

# Enable verbose SyncSwap diagnostics (shows pool discovery, ABI probing, fallback methods)
npm run cli -- diag quotes --dex syncswap_v1 --syncswap-verbose

# Override RPC for testing (diag commands only)
npm run cli -- diag health --rpc https://custom-rpc.example.com

# Display current configuration
npm run cli -- diag config
```

**New Features:**
- PancakeSwap V3 now uses multi-hop quoting via USDC when direct pools lack liquidity
- Displays human-readable amounts with proper decimal formatting
- Shows per-DEX rate (e.g., "2000.123456 USDC per WETH")
- Calculates and displays spread % between all successful quotes
- **Shows summary of DEXes that returned quotes vs skipped per pair**
- **Displays detailed skip reasons (e.g., "no pool returned by factory", "revert during quote")**
- SyncSwap resilient quoting with multi-ABI probing, off-chain fallback, and auto-disable (see TROUBLESHOOTING.md)

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

# Monitor for 12 minutes (fractional hours supported)
npm run cli -- monitor --duration 0.2

# Monitor for 30 minutes
npm run cli -- monitor --duration 0.5

# Monitor for default 48 hours
npm run cli -- monitor
```

Continuously scans configured token pairs, tracks arbitrage opportunities in SQLite with lifecycle tracking (open/closed), computes decay times, and generates hourly statistics.

**Note:** The `--duration` flag now supports fractional hours (e.g., 0.2 for 12 minutes, 0.5 for 30 minutes).

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

### Scan Once - Opportunity Recognition

```bash
# Scan all configured pairs once and display opportunities
npm run cli -- scan-once

# Filter by specific pairs
npm run cli -- scan-once --pairs WETH/USDC,USDC/USDT

# Set minimum spread threshold (in basis points, can be negative to show lossy trades)
npm run cli -- scan-once --min-spread-bps 10

# Show negative spreads (lossy round-trips)
npm run cli -- scan-once --min-spread-bps -1000

# Override flashloan amount (legacy format, in wei)
npm run cli -- scan-once --amount 1000000000000000000

# Override flashloan amount (human-readable format) - NEW!
npm run cli -- scan-once --amount-human "1 WETH"
npm run cli -- scan-once --amount-human "2000 USDC"

# Use custom RPC (testing only)
npm run cli -- scan-once --rpc https://custom-rpc.example.com
```

Scans all configured pairs once and prints a sorted table of recognized opportunities sorted by spread. Shows:
- Token pair and size (annotated with human-readable value when using --amount-human)
- Best path for each leg (DEX used)
- Zero-slippage spread (gross profit potential) - **now shows negative values for lossy trades**
- Slippage-adjusted spread (realistic profit after slippage) - **now shows negative values for lossy trades**
- Estimated net profit (after gas costs)
- Executable flag (✓ if meets profit thresholds)
- Detailed path metadata including pool type and method for top opportunities

**Note**: Spread values are now signed and can be negative to accurately reflect lossy round-trips. Recognition and execution logic remain unchanged (only positive spreads are considered executable).

## Recognition vs Executable

The bot distinguishes between **recognized** opportunities and **executable** opportunities:

### Recognized Opportunities
An opportunity is **recognized** when:
- Gross spread (zero-slippage round-trip) is positive (`grossSpreadBps > 0`)
- This indicates theoretical arbitrage exists across DEXes

All recognized opportunities are logged and stored in the database with `recognized=1`, regardless of profitability.

### Executable Opportunities
An opportunity is **executable** when it meets additional criteria:
- Recognized spread is positive AND
- Slippage-adjusted net profit ≥ `minProfitUSD` (configured in `strategy.json`)
- Slippage-adjusted spread remains positive after applying `maxSlippage`

The `monitor` command with `--recognize-all` flag will record all recognized opportunities in the database, even when `executable=false`. This provides visibility into market conditions and spread patterns.

**Key insight**: Recognition is about market observation; execution is about profitable action.

## USD Conversion

The bot uses deterministic USD conversion for profit calculations:

### Anchor: USDC = $1.00
- USDC is treated as $1.00 (6 decimals)
- All other token values are derived from USDC

### Small-Size Reference Quotes
For non-USDC tokens, the bot:
1. Fetches a small reference quote (e.g., 0.1 WETH → USDC or 100 USDT → USDC)
2. Prefers PancakeSwap V3 Quoter for accuracy
3. Falls back to Mute if PancakeSwap unavailable
4. Caches the result for 5 seconds (TTL)
5. Calculates price per 1 token unit

### Deterministic Math
- All internal calculations use `BigInt` (no floating-point)
- USD values are stored as integers with 6 decimals (USDC precision)
- Display formatting only converts to decimal strings at presentation
- Rounding down for `amountOutMinimum` ensures safety

Example:
```
Token: WETH (18 decimals)
Reference quote: 0.1 WETH → 200 USDC
Price: 200 / 0.1 = 2000 USDC per 1 WETH
Amount: 2 WETH = 2 * 2000 = $4000 USD
```

## Mainnet Checklist

Before running the bot on mainnet with real funds:

### Environment Setup
- [ ] Set `ZKSYNC_RPC_HTTP` to a reliable provider (Alchemy, Infura, or self-hosted)
- [ ] Enable `LOG_LEVEL=info` or `LOG_LEVEL=debug` for visibility
- [ ] Ensure RPC provider has sufficient rate limits for continuous operation

### Configuration
- [ ] Review `strategy.json`:
  - Set appropriate `minProfitUSD` (recommended: ≥$3)
  - Configure `maxSlippage` (recommended: 0.5% = 0.005)
  - Set `flashloanSize` for each token (start small)
- [ ] Review `dexes.json`:
  - Enable only trusted, audited DEXes
  - Verify contract addresses on zkSync Era block explorer
  - Velocore disabled by default (safety)

### Testing Phase
1. **Dry-run mode**: `npm run cli -- execute --dry-run` for 24-48 hours
2. **Monitor-only**: `npm run cli -- monitor --duration 24 --recognize-all`
3. **Scan-once**: `npm run cli -- scan-once` to verify opportunity detection
4. **Diagnostics**: `npm run cli -- diag quotes` to verify DEX connectivity

### Monitoring
- [ ] Set up alerts (Telegram bot or external monitoring)
- [ ] Monitor gas prices and set `maxGasPrice` appropriately
- [ ] Track RPC usage in provider dashboard
- [ ] Review `monitoring.sqlite` database for opportunity patterns

### Live Execution
- [ ] Start with small `flashloanSize` (test with $100-$500)
- [ ] Use `--interval 60` or higher for conservative execution
- [ ] Monitor first 10-20 executions closely
- [ ] Gradually increase position sizes after proven profitability

### Emergency Procedures
- [ ] Know how to pause the bot (`SIGINT` or `SIGTERM`)
- [ ] Have emergency withdrawal plan
- [ ] Monitor wallet balances and token approvals
- [ ] Set `dailyGasBudget` to limit losses

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
