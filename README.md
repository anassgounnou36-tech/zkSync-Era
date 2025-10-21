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

## Highlights

- Upgradable contracts (UUPS), roles (admin, pauser, executor, strategist, withdrawer)
- **SyncSwap Vault** flashloan integration with multi-token support (0% fee)
- **DEX Integration**: Mute.io swap support; SyncSwap routing deferred to off-chain
- Arbitrage executor with token/pool whitelists, slippage guard, SafeERC20
- Flashloan router with `executeFlashloanMulti(tokens[], amounts[], data)` and `receiveFlashLoan` callback
- **Live price fetching** from DEXes with graceful error handling
- **Profit calculator** with gas cost modeling and profitability validation
- Off-chain orchestration: mempool monitor, price/route builder, simulator, submitter
- Telegram alerts + manual commands (pause/resume/kill/status)
- Analytics DB + PnL reports
- CI: build, lint, test (integration tests require `ZKSYNC_LIVE_TESTS=1`); Security: slither (non-blocking)

## Status

- **Production-ready SyncSwap Vault flashloan integration** with real mainnet addresses
- **Live DEX price fetching** from Mute.io (SyncSwap V1/V2 deferred)
- **Profit modeling** with gas cost estimation and USD conversion
- End-to-end dry-run with mocks and placeholder addresses
- zkSync Era mainnet-ready configuration with safety parameters
- Integration tests guarded by environment flag to keep CI green
- All tests passing; TypeScript and Solidity compile successfully
