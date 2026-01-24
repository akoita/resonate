"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const crypto_1 = require("crypto");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./modules/app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    // Enable CORS for frontend
    app.enableCors({
        origin: ['http://localhost:3001', 'http://localhost:3000'],
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
        }));
        next();
    });
    await app.listen(3000);
}
bootstrap();
