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

## Configuration

The bot uses two main configuration files:

- **config/dexes.json** - DEX addresses, token addresses, and flashloan provider settings for zkSync Era mainnet
- **config/strategy.json** - Arbitrage strategy parameters including minimum profit thresholds, gas limits, and safety settings

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
- **DEX Integration**: Mute.io swap support; SyncSwap V1 price fetching via PoolMaster->getPool + Router->getAmountOut
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
- **Live DEX price fetching** from Mute.io and SyncSwap V1 (best-effort)
- **Profit modeling** with gas cost estimation and USD conversion
- **Continuous price gap monitoring** with SQLite persistence and lifecycle tracking
- **Execution orchestrator** with safety gates and flashloan integration
- **Comprehensive CLI** for monitoring, execution, and reporting
- End-to-end dry-run with mocks and placeholder addresses
- zkSync Era mainnet-ready configuration with safety parameters
- Integration tests guarded by environment flag to keep CI green
- All tests passing; TypeScript and Solidity compile successfully
