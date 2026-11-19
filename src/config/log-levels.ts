import { LogLevel } from '@nestjs/common';

const LOG_LEVEL_MAP: Record<string, LogLevel[]> = {
  error: ['error'],
  warn: ['error', 'warn'],
  log: ['error', 'warn', 'log'],
  debug: ['error', 'warn', 'log', 'debug'],
  verbose: ['error', 'warn', 'log', 'debug', 'verbose'],
};

/** Maps a LOG_LEVEL value to the Nest log levels to enable (default: log). */
export function resolveLogLevels(level: string): LogLevel[] {
  return LOG_LEVEL_MAP[level.toLowerCase()] ?? LOG_LEVEL_MAP.log;
}

/** Startup banner; only mentions the Swagger docs outside production. */
export function startupMessage(env: string, port: number | string): string {
  return env === 'production'
    ? `MergeFi backend listening on port ${port}`
    : `MergeFi backend listening on port ${port} — docs at /api/docs`;
}
