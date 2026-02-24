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

  // Self-Healing: Reset indexer if it's vastly out of date (e.g. from an old Sepolia fork/deployment)
  try {
    const { prisma } = require("./db/prisma");
    const chainId = parseInt(process.env.AA_CHAIN_ID || "11155111");
    if (chainId === 11155111) {
      const state = await prisma.indexerState.findUnique({ where: { chainId } });
      const currentSepoliaBlock = 10295000n; // Recent safe cutoff
      // If the indexer is millions of blocks behind, fast-forward it automatically
      if (!state || (state.lastBlockNumber < 10290000n && state.lastBlockNumber > 0n)) {
        console.log(`[Self-Healing] Detected stale indexer state (Block ${state?.lastBlockNumber}). Fast-forwarding to ${currentSepoliaBlock}...`);
        await prisma.indexerState.upsert({
          where: { chainId },
          update: { lastBlockNumber: currentSepoliaBlock },
          create: { chainId, lastBlockNumber: currentSepoliaBlock },
        });
        console.log(`[Self-Healing] Indexer fast-forward complete.`);
      }
    }

    // Self-Healing: Fix hardcoded localhost:3000 stem URIs from local storage provider
    const backendUrl = process.env.BACKEND_URL;
    if (backendUrl && !backendUrl.includes('localhost')) {
      const brokenStems = await prisma.stem.findMany({
        where: { uri: { startsWith: 'http://localhost:3000/' } },
        select: { id: true },
      });
      if (brokenStems.length > 0) {
        console.log(`[Self-Healing] Found ${brokenStems.length} stems with localhost URIs, migrating to ${backendUrl}...`);
        await prisma.$executeRawUnsafe(
          `UPDATE "Stem" SET uri = REPLACE(uri, 'http://localhost:3000', $1) WHERE uri LIKE 'http://localhost:3000%'`,
          backendUrl
        );
        console.log(`[Self-Healing] Fixed ${brokenStems.length} stem URIs.`);
      }
      // Also fix Release artworkUrl
      const brokenReleases = await prisma.$executeRawUnsafe(
        `UPDATE "Release" SET "artworkUrl" = REPLACE("artworkUrl", 'http://localhost:3000', $1) WHERE "artworkUrl" LIKE 'http://localhost:3000%'`,
        backendUrl
      );
      if (brokenReleases > 0) {
        console.log(`[Self-Healing] Fixed ${brokenReleases} release artwork URLs.`);
      }
    }
  } catch (e) {
    console.warn(`[Self-Healing] Could not check indexer state:`, e);
  }

  const app = await NestFactory.create(AppModule);

  const allowedOrigins = ['http://localhost:3001', 'http://localhost:3000'];
  if (process.env.CORS_ORIGIN) {
    allowedOrigins.push(...process.env.CORS_ORIGIN.split(',').map(o => o.trim()));
  }

  app.enableCors({
    origin: allowedOrigins,
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
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Backend is running on: http://localhost:${port}`);
}

bootstrap();
