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

## Optional Live Integration Tests

By default, integration tests that require network access are skipped to keep CI green. To run live integration tests against zkSync Era mainnet:

```bash
ZKSYNC_LIVE_TESTS=1 npm test
```

Note: Live tests may take longer and require a working RPC connection to zkSync Era mainnet.
