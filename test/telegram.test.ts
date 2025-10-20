import { describe, it, expect } from "vitest";
import { TelegramBot } from "../src/telegram/bot.js";

describe("TelegramBot", () => {
  it("should initialize bot (disabled by default)", () => {
    const bot = new TelegramBot();
    expect(bot).toBeDefined();
  });

  it("should handle alerts when disabled", async () => {
    const bot = new TelegramBot();
    // Should not throw when disabled
    await bot.sendAlert({
      level: "info",
      title: "Test Alert",
      message: "This is a test",
      timestamp: Date.now(),
    });
    expect(true).toBe(true);
  });
});
