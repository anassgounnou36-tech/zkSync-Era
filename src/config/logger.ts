import pino from "pino";
import { loadConfig } from "../config/config.js";

const config = loadConfig();

export const logger = pino({
  level: config.logLevel,
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "HH:MM:ss Z",
      ignore: "pid,hostname",
    },
  },
});
