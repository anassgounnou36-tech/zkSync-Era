import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const ConfigSchema = z.object({
  privateKey: z.string().default("0x0000000000000000000000000000000000000000000000000000000000000000"),
  zkSyncRpcUrl: z.string().default("https://mainnet.era.zksync.io"),
  zkSyncTestnetRpcUrl: z.string().default("https://testnet.era.zksync.dev"),
  zkSyncRpcHttp: z.string().optional(),
  zkSyncRpcWs: z.string().optional(),
  flashloanRouterAddress: z.string().optional(),
  arbitrageExecutorAddress: z.string().optional(),
  minProfitThresholdUsd: z.coerce.number().default(10),
  maxSlippageBps: z.coerce.number().default(50),
  gasPriceMultiplier: z.coerce.number().default(1.2),
  telegramBotToken: z.string().optional(),
  telegramChatId: z.string().optional(),
  telegramEnabled: z.coerce.boolean().default(false),
  httpPort: z.coerce.number().default(3000),
  httpHost: z.string().default("0.0.0.0"),
  dbPath: z.string().default("./data/analytics.sqlite"),
  dryRun: z.coerce.boolean().default(true),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  routerWhitelist: z.string().transform((s) => s.split(",").filter(Boolean)).default(""),
  tokenWhitelist: z.string().transform((s) => s.split(",").filter(Boolean)).default(""),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const config = ConfigSchema.parse({
    privateKey: process.env.PRIVATE_KEY,
    zkSyncRpcUrl: process.env.ZKSYNC_ERA_RPC_URL,
    zkSyncTestnetRpcUrl: process.env.ZKSYNC_ERA_TESTNET_RPC_URL,
    zkSyncRpcHttp: process.env.ZKSYNC_RPC_HTTP,
    zkSyncRpcWs: process.env.ZKSYNC_RPC_WS,
    flashloanRouterAddress: process.env.FLASHLOAN_ROUTER_ADDRESS,
    arbitrageExecutorAddress: process.env.ARBITRAGE_EXECUTOR_ADDRESS,
    minProfitThresholdUsd: process.env.MIN_PROFIT_THRESHOLD_USD,
    maxSlippageBps: process.env.MAX_SLIPPAGE_BPS,
    gasPriceMultiplier: process.env.GAS_PRICE_MULTIPLIER,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    telegramEnabled: process.env.TELEGRAM_ENABLED,
    httpPort: process.env.HTTP_PORT,
    httpHost: process.env.HTTP_HOST,
    dbPath: process.env.DB_PATH,
    dryRun: process.env.DRY_RUN,
    logLevel: process.env.LOG_LEVEL,
    routerWhitelist: process.env.ROUTER_WHITELIST,
    tokenWhitelist: process.env.TOKEN_WHITELIST,
  });

  return config;
}
