import { type NextFunction, type Request, type Response } from "express";
import { normalizeRequestId, writeStructuredLog } from "./structured_logging";

export interface RequestWithObservability extends Request {
  requestId?: string;
}

export function requestObservabilityMiddleware() {
  return (req: RequestWithObservability, res: Response, next: NextFunction) => {
    const requestId = normalizeRequestId(req.headers["x-request-id"]);
    const startedAt = Date.now();

    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);

    res.on("finish", () => {
      writeStructuredLog({
        level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
        event: "http.request.completed",
        message: "HTTP request completed",
        requestId,
        method: req.method,
        path: requestPath(req),
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        hasAuth: Boolean(req.headers.authorization),
        paymentHeaderType: resolvePaymentHeaderType(req),
      });
    });

    next();
  };
}

function requestPath(req: Request): string {
  return req.path || req.url.split("?")[0] || "/";
}

function resolvePaymentHeaderType(req: Request): "payment-signature" | "x-payment" | null {
  if (req.headers["payment-signature"]) return "payment-signature";
  if (req.headers["x-payment"]) return "x-payment";
  return null;
}

