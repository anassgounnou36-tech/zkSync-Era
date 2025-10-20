import Fastify from "fastify";
import { logger } from "../config/logger.js";
import { loadConfig } from "../config/config.js";
import { AnalyticsDB } from "../analytics/db.js";

const config = loadConfig();

// Simple in-memory rate limiter
const rateLimiter = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 100; // requests per window
const WINDOW_MS = 60000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const clientData = rateLimiter.get(ip);

  if (!clientData || now > clientData.resetTime) {
    rateLimiter.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    return true;
  }

  if (clientData.count >= RATE_LIMIT) {
    return false;
  }

  clientData.count++;
  return true;
}

/**
 * HTTP API server for monitoring and control
 */
export async function createServer() {
  const fastify = Fastify({
    logger: false,
  });

  const db = new AnalyticsDB();

  // Rate limiting middleware
  fastify.addHook("preHandler", async (request, reply) => {
    const ip = request.ip;
    if (!checkRateLimit(ip)) {
      reply.code(429).send({ error: "Too many requests" });
    }
  });

  // Health check
  fastify.get("/health", async () => {
    return { status: "ok", timestamp: Date.now() };
  });

  // Get status
  fastify.get("/status", async () => {
    return {
      status: "running",
      mode: config.dryRun ? "dry-run" : "live",
      tradeCount: db.getTradeCount(),
      totalPnL: db.getTotalPnL().toString(),
    };
  });

  // Get recent trades
  fastify.get("/trades", async (request) => {
    const { limit = "10" } = request.query as { limit?: string };
    return db.getRecentTrades(parseInt(limit));
  });

  // Get PnL summary
  fastify.get("/pnl", async () => {
    return {
      totalPnL: db.getTotalPnL().toString(),
      tradeCount: db.getTradeCount(),
    };
  });

  return fastify;
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  createServer()
    .then((server) => {
      server.listen({ port: config.httpPort, host: config.httpHost }, (err, address) => {
        if (err) {
          logger.error({ err }, "Failed to start HTTP server");
          process.exit(1);
        }
        logger.info(`HTTP server listening on ${address}`);
      });
    })
    .catch((error) => {
      logger.error({ error }, "Failed to create server");
      process.exit(1);
    });
}
