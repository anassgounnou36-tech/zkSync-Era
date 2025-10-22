# Getting Started

1. Install deps:

```bash
npm install
```

2. Copy env:

```bash
cp .env.example .env
```

3. Build, lint, test:

```bash
npm run build
npm run lint
npm run test
```

4. Run a dry-run simulation:

```bash
npm run simulate
```

5. Deploy proxies to Era testnet:

```bash
npm run deploy
```

6. Configure Telegram (optional): set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID in .env then integrate via src/telegram/bot.ts.

## Configuration Files

The bot uses two main configuration files:

- `config/dexes.json` - DEX addresses, token addresses, and flashloan provider settings for zkSync Era
- `config/strategy.json` - Arbitrage strategy parameters including min profit thresholds, gas limits, and safety settings

## CLI Commands

The bot now includes a comprehensive CLI for monitoring and execution:

### Monitor Price Gaps

Run continuous price gap monitoring for specified duration (default 48 hours):

```bash
npm run cli -- monitor --duration 2
```

This will:
- Scan configured token pairs across all enabled DEXes
- Record opportunities in SQLite database with lifecycle tracking
- Calculate decay time when spreads close
- Generate hourly statistics
- Create a final monitoring report

### Execute Arbitrage

Start automated arbitrage execution:

```bash
# Dry run (recommended for testing)
npm run cli -- execute --dry-run

# Live execution (requires configured wallet and contract addresses)
npm run cli -- execute
```

The orchestrator will:
- Continuously scan for profitable opportunities
- Apply safety gates (min profit, max gas, slippage limits)
- Execute flashloan-based trades when thresholds are met
- Track daily gas budget

### Generate Reports

Generate a monitoring report from collected data:

```bash
npm run cli -- report
```

This creates `monitoring-report.json` with:
- Total opportunities detected
- Opportunity decay times
- Hourly statistics breakdown
- Top opportunities by profit

### View Configuration

Display current bot configuration:

```bash
npm run cli -- info
```

## Optional Live Integration Tests

By default, integration tests that require network access are skipped to keep CI green. To run live integration tests against zkSync Era mainnet:

```bash
ZKSYNC_LIVE_TESTS=1 npm test
```

Note: Live tests may take longer and require a working RPC connection to zkSync Era mainnet.
