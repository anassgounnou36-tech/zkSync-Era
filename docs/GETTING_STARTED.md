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
