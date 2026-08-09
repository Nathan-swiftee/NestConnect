import { ConsoleLogger, type LoggerService, type LogLevel } from "@nestjs/common";
import { env } from "../config/env";

/**
 * Structured logging without pulling in a logging stack. In production every line
 * is a single JSON object (level, time, context, message) that any log drain can
 * parse and ship; in development we keep Nest's readable console output. Swap in
 * pino later if richer transports are needed — call sites use the standard Nest
 * Logger either way.
 */
export class StructuredLogger extends ConsoleLogger implements LoggerService {
  private write(level: LogLevel, message: unknown, context?: string): void {
    const line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      context: context ?? this.context ?? undefined,
      message: typeof message === "string" ? message : safe(message),
    });
    // eslint-disable-next-line no-console
    (level === "error" ? console.error : console.log)(line);
  }

  log(message: unknown, context?: string): void {
    if (env.isProd) this.write("log", message, context);
    else super.log(message as string, context as string);
  }
  error(message: unknown, stackOrContext?: string, context?: string): void {
    if (env.isProd) {
      const ctx = context ?? stackOrContext;
      this.write("error", message, ctx);
    } else super.error(message as string, stackOrContext as string, context as string);
  }
  warn(message: unknown, context?: string): void {
    if (env.isProd) this.write("warn", message, context);
    else super.warn(message as string, context as string);
  }
  debug(message: unknown, context?: string): void {
    if (env.isProd) this.write("debug", message, context);
    else super.debug?.(message as string, context as string);
  }
  verbose(message: unknown, context?: string): void {
    if (env.isProd) this.write("verbose", message, context);
    else super.verbose?.(message as string, context as string);
  }
}

function safe(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
