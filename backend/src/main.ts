import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { join } from "path";
import * as express from "express";
import { AppModule } from "./modules/app.module";
import { RedisIoAdapter } from "./modules/shared/redis.adapter";
import { getCorsAllowedOrigins } from "./config/cors";
import { requestObservabilityMiddleware } from "./modules/shared/request_observability.middleware";

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

    // Self-Healing: Convert any absolute URLs in stem URIs and release artwork to relative paths
    // This ensures the frontend can prepend its own API_BASE for browser access
    const absoluteStemCount = await prisma.$executeRaw`UPDATE "Stem" SET uri = regexp_replace(uri, '^https?://[^/]+', '') WHERE uri ~ '^https?://'`;
    if (absoluteStemCount > 0) {
      console.log(`[Self-Healing] Converted ${absoluteStemCount} stem URIs to relative paths.`);
    }
    const absoluteArtworkCount = await prisma.$executeRaw`UPDATE "Release" SET "artworkUrl" = regexp_replace("artworkUrl", '^https?://[^/]+', '') WHERE "artworkUrl" ~ '^https?://'`;
    if (absoluteArtworkCount > 0) {
      console.log(`[Self-Healing] Converted ${absoluteArtworkCount} release artwork URLs to relative paths.`);
    }
  } catch (e) {
    console.warn(`[Self-Healing] Could not check indexer state:`, e);
  }

  const app = await NestFactory.create(AppModule);

  // Enable cross-instance WebSocket broadcasting via Redis pub/sub
  try {
    const redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);
    console.log('[Bootstrap] Redis Socket.IO adapter enabled');
  } catch (err) {
    console.warn('[Bootstrap] Redis Socket.IO adapter failed, falling back to in-memory:', err);
  }

  const allowedOrigins = getCorsAllowedOrigins();
  console.log(`[Bootstrap] CORS allowed origins: ${allowedOrigins.join(", ")}`);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.use(requestObservabilityMiddleware());
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Backend is running on: http://localhost:${port}`);
}

bootstrap();
