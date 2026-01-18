import "reflect-metadata";
import { randomUUID } from "crypto";
import { NestFactory } from "@nestjs/core";
import { type NextFunction, type Request, type Response } from "express";
import { AppModule } from "./modules/app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers["x-request-id"];
    const requestId = Array.isArray(incoming) ? incoming[0] : incoming;
    const id = requestId ?? randomUUID();
    res.setHeader("x-request-id", id);
    (req as any).requestId = id;
    console.info(
      JSON.stringify({
        level: "info",
        message: "request",
        requestId: id,
        method: req.method,
        path: req.url,
      })
    );
    next();
  });
  await app.listen(3000);
}

bootstrap();
