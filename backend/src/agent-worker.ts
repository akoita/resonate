import "dotenv/config";
import "reflect-metadata";
import { randomUUID } from "crypto";
import { NestFactory } from "@nestjs/core";
import { type NextFunction, type Request, type Response } from "express";
import { AgentWorkerModule } from "./modules/agents/agent_worker.module";

async function bootstrap() {
  const app = await NestFactory.create(AgentWorkerModule);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers["x-request-id"];
    const requestId = Array.isArray(incoming) ? incoming[0] : incoming;
    const id = requestId ?? randomUUID();
    res.setHeader("x-request-id", id);
    (req as any).requestId = id;
    next();
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Agent runtime worker is running on: http://localhost:${port}`);
}

bootstrap();
