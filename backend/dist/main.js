"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const crypto_1 = require("crypto");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./modules/app.module");
async function bootstrap() {
    console.log("========================================");
    console.log("🚀 RESONATE BACKEND BOOTING...");
    console.log("========================================");
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    // Global pipes
    // Enable CORS for frontend
    const corsOrigins = [
        'http://localhost:3001',
        'http://localhost:3000',
        ...(process.env.CORS_ORIGIN ? [process.env.CORS_ORIGIN] : []),
    ];
    app.enableCors({
        origin: corsOrigins,
        credentials: true,
    });
    app.use((req, res, next) => {
        const incoming = req.headers["x-request-id"];
        const requestId = Array.isArray(incoming) ? incoming[0] : incoming;
        const id = requestId ?? (0, crypto_1.randomUUID)();
        res.setHeader("x-request-id", id);
        req.requestId = id;
        console.info(JSON.stringify({
            level: "info",
            message: "request",
            requestId: id,
            method: req.method,
            path: req.url,
            hasAuth: !!req.headers["authorization"],
            authHeader: req.headers["authorization"]?.toString().substring(0, 20) + "...",
        }));
        next();
    });
    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`🚀 Backend is running on: http://localhost:${port}`);
}
bootstrap();
