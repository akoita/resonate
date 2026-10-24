import type { NextFunction, Request, Response } from "express";

const HEALTH_PATH = "/health";

/**
 * The `worker` runtime mode (#1608) boots the whole Nest app so the in-process
 * event bus keeps every indexer wired to the subscribers that persist and fan
 * out its events, but it is not a public API. Its HTTP listener exists so the
 * platform can probe it. This answers `404` for every path except `/health`
 * (and sub-paths), before any route, guard or controller runs.
 */
export function workerHealthOnlyMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const path = req.path;
    if (path === HEALTH_PATH || path.startsWith(`${HEALTH_PATH}/`)) {
      next();
      return;
    }
    res.status(404).json({
      statusCode: 404,
      message: "This process runs background workers only",
      error: "Not Found",
    });
  };
}
