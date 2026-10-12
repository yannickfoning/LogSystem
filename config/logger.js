import pino from 'pino';
import { createRequire } from 'node:module';

const isDevelopment = process.env.NODE_ENV === 'development';
let prettyTransportAvailable = false;

if (isDevelopment) {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    prettyTransportAvailable = true;
  } catch {
    // Production-only installs omit pino-pretty; continue with structured JSON logs.
  }
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: prettyTransportAvailable
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname'
        }
      }
    : undefined
});

export default logger;
