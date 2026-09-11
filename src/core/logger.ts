/**
 * Splendid Log Client for BotDeflector
 * Zero-cost, non-blocking telemetry logging to https://logs.seanbeck.net
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEvent {
  app: string;
  env: string;
  level: LogLevel;
  message: string;
  context: Record<string, unknown>;
  timestamp: string;
}

class DeflectorLogger {
  private endpoint = 'https://logs.seanbeck.net';
  private app = 'bot-deflector';
  private env = 'production';
  private queue: LogEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  public debug(message: string, context?: Record<string, unknown>): void {
    this.enqueue('debug', message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.enqueue('info', message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.enqueue('warn', message, context);
  }

  public error(messageOrError: Error | string, errorOrContext?: any, extraContext?: Record<string, unknown>): void {
    let msg = '';
    let ctx: Record<string, unknown> = {};

    if (messageOrError instanceof Error) {
      msg = messageOrError.message;
      ctx = {
        name: messageOrError.name,
        stack: messageOrError.stack,
        ...(errorOrContext || {})
      };
    } else {
      msg = String(messageOrError);
      if (errorOrContext instanceof Error) {
        ctx = {
          errorMessage: errorOrContext.message,
          errorName: errorOrContext.name,
          stack: errorOrContext.stack,
          ...(extraContext || {})
        };
      } else if (typeof errorOrContext === 'object' && errorOrContext !== null) {
        ctx = { ...errorOrContext, ...(extraContext || {}) };
      }
    }

    this.enqueue('error', msg, ctx);
  }

  private enqueue(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    this.queue.push({
      app: this.app,
      env: this.env,
      level,
      message,
      context: context || {},
      timestamp: new Date().toISOString()
    });

    if (this.queue.length >= 20) {
      this.flush();
    } else if (!this.timer && typeof setTimeout !== 'undefined') {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, 2000);
    }
  }

  public async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);
    const url = `${this.endpoint}/api/v1/logs`;

    try {
      if (typeof fetch !== 'undefined') {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batch),
          keepalive: true
        });
      }
    } catch {
      // Fail silently to never degrade user browsing
    }
  }
}

export const logger = new DeflectorLogger();
export default logger;
