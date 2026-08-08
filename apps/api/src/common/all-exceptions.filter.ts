import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { redactSecrets } from "../crypto/redact";

/**
 * Catches every unhandled error, logs it with request context (structured, via
 * the Nest logger), and returns a clean JSON body. 5xx errors log the stack;
 * expected 4xx HttpExceptions log a single line. This is the lean "error
 * reporting" seam — logs go to the structured logger and on to any drain; a
 * Sentry SDK can hook in here later without touching call sites.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exception");

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    // Non-HTTP contexts (WebSocket) have no response to write — let them pass.
    if (host.getType() !== "http") return;
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const message =
      exception instanceof HttpException
        ? exception.message
        : "Internal server error"; // never leak internals to the client

    const where = `${req.method} ${req.originalUrl}`;
    if (status >= 500) {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`${status} ${where} — ${redactSecrets(String(message))}\n${redactSecrets(stack)}`);
    } else {
      this.logger.warn(`${status} ${where} — ${redactSecrets(String(message))}`);
    }

    if (res.headersSent) return;
    res.status(status).json({
      statusCode: status,
      error: exception instanceof HttpException ? exception.name : "InternalServerError",
      message,
    });
  }
}
