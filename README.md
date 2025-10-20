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

## Highlights

- Upgradable contracts (UUPS), roles (admin, pauser, executor, strategist, withdrawer)
- Arbitrage executor with token/pool whitelists, slippage guard, SafeERC20
- Flashloan router with generic `executeFlashloan(token, amount, data)`
- Off-chain orchestration: mempool monitor, price/route builder, simulator, submitter
- Telegram alerts + manual commands (pause/resume/kill/status)
- Analytics DB + PnL reports
- CI: build, lint, test; Security: slither (non-blocking)

## Status

- End-to-end dry-run with mocks and placeholder addresses
- zkSync Era testnet ready; mainnet requires filling real router/pool addresses and limits
