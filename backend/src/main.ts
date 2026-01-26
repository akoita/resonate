import "reflect-metadata";
import { randomUUID } from "crypto";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { type NextFunction, type Request, type Response } from "express";
import { join } from "path";
import * as express from "express";
import { AppModule } from "./modules/app.module";

async function bootstrap() {
  console.log("========================================");
  console.log("🚀 RESONATE BACKEND BOOTING...");
  console.log("========================================");
  const app = await NestFactory.create(AppModule);

  // Serve uploaded audio files
  app.use("/uploads", express.static(join(process.cwd(), "uploads")));

  // Global pipes
  // Enable CORS for frontend
  app.enableCors({
    origin: ['http://localhost:3001', 'http://localhost:3000'],
    credentials: true,
  });

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
        hasAuth: !!req.headers["authorization"],
        authHeader: req.headers["authorization"]?.toString().substring(0, 20) + "...",
      })
    );
    next();
  });
  await app.listen(3000);
}

bootstrap();
