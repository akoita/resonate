import {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from "@nestjs/common";
import multer from "multer";
import { transformException } from "@nestjs/platform-express/multer/multer/multer.utils";
import { Observable, defer, from, throwError } from "rxjs";
import { catchError, concatMap, map } from "rxjs/operators";
import {
  cleanupIngestionMultipartRequest,
  initializeIngestionMultipartRequest,
} from "./ingestion-multipart.storage";

/**
 * Multer's built-in interceptor rejects parser errors before the controller is
 * entered. Ingestion needs a lifecycle boundary around that parser as well so
 * request-owned directories are removed for both parser and controller
 * outcomes.
 */
export class IngestionMultipartInterceptor implements NestInterceptor {
  private readonly upload: ReturnType<typeof multer>;

  constructor(
    private readonly fields: readonly multer.Field[],
    options: multer.Options,
  ) {
    this.upload = multer(options);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<{ headers?: Record<string, string | string[] | undefined> }>();
    const contentType = request.headers?.["content-type"];
    const isMultipart = (Array.isArray(contentType) ? contentType[0] : contentType)
      ?.toLowerCase()
      .startsWith("multipart/");

    if (!isMultipart) return next.handle();

    initializeIngestionMultipartRequest(request as any);
    const parseRequest = defer(() => new Promise<void>((resolve, reject) => {
      this.upload.fields(this.fields)(http.getRequest(), http.getResponse(), (error) => {
        if (error) {
          reject(transformException(error) ?? error);
          return;
        }
        resolve();
      });
    }));

    return parseRequest.pipe(
      concatMap(() => defer(() => next.handle())),
      concatMap((value) => from(cleanupIngestionMultipartRequest(request)).pipe(
        map(() => value),
      )),
      catchError((error: unknown) => from(cleanupIngestionMultipartRequest(request)).pipe(
        concatMap(() => throwError(() => error)),
      )),
    );
  }
}
