import { Telegraf } from "telegraf";
import { logger } from "../config/logger.js";
import { loadConfig } from "../config/config.js";

const config = loadConfig();

export interface AlertMessage {
  level: "info" | "warning" | "error";
  title: string;
  message: string;
  timestamp: number;
}

/**
 * Telegram bot for alerts and manual control
 */
export class TelegramBot {
  private bot?: Telegraf;
  private enabled: boolean;

  constructor() {
    this.enabled = config.telegramEnabled && !!config.telegramBotToken;

    if (this.enabled && config.telegramBotToken) {
      this.bot = new Telegraf(config.telegramBotToken);
      this.setupCommands();
    } else {
      logger.info("Telegram bot disabled");
    }
  }

  /**
   * Setup bot commands
   */
  private setupCommands(): void {
    if (!this.bot) return;

    this.bot.command("status", (ctx) => {
      ctx.reply("🤖 Bot Status: Active\n📊 Mode: " + (config.dryRun ? "DRY RUN" : "LIVE"));
    });

    this.bot.command("pause", (ctx) => {
      logger.info("Pause command received");
      ctx.reply("⏸️ Bot paused");
    });

    this.bot.command("resume", (ctx) => {
      logger.info("Resume command received");
      ctx.reply("▶️ Bot resumed");
    });

    this.bot.command("kill", (ctx) => {
      logger.info("Kill command received");
      ctx.reply("🛑 Bot stopping...");
      process.exit(0);
    });

    logger.info("Telegram commands setup complete");
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (!this.enabled || !this.bot) {
      logger.info("Telegram bot not started (disabled)");
      return;
    }

    try {
      await this.bot.launch();
      logger.info("Telegram bot started");
    } catch (error) {
      logger.error({ error }, "Failed to start Telegram bot");
    }
  }

  /**
   * Send alert message
   */
  async sendAlert(alert: AlertMessage): Promise<void> {
    if (!this.enabled || !this.bot || !config.telegramChatId) {
      logger.debug({ alert }, "Alert not sent (Telegram disabled)");
      return;
    }

    const emoji = { info: "ℹ️", warning: "⚠️", error: "🚨" };
    const message = `${emoji[alert.level]} *${alert.title}*\n\n${alert.message}\n\n_${new Date(alert.timestamp).toISOString()}_`;

    try {
      await this.bot.telegram.sendMessage(config.telegramChatId, message, {
        parse_mode: "Markdown",
      });
      logger.debug({ alert }, "Alert sent via Telegram");
    } catch (error) {
      logger.error({ error, alert }, "Failed to send Telegram alert");
    }
  }

  /**
   * Stop the bot
   */
  stop(): void {
    if (this.bot) {
      this.bot.stop();
      logger.info("Telegram bot stopped");
    }
  }
}
