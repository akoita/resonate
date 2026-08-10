import {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
  PayloadTooLargeException,
} from "@nestjs/common";
import { Observable } from "rxjs";

/** Rejects declared oversized multipart requests before Multer buffers files. */
export class ContentLengthLimitInterceptor implements NestInterceptor {
  constructor(private readonly maxBytes: number, private readonly label: string) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined> }>();
    const rawLength = request.headers?.["content-length"];
    const contentLength = Number(Array.isArray(rawLength) ? rawLength[0] : rawLength);
    if (Number.isSafeInteger(contentLength) && contentLength > this.maxBytes) {
      throw new PayloadTooLargeException(`${this.label} request must be ${Math.floor(this.maxBytes / (1024 * 1024))} MiB or smaller`);
    }
    return next.handle();
  }
}
