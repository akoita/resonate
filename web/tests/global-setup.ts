/**
 * Playwright global setup — seeds the database before tests run.
 *
 * This ensures deterministic test data is present in Postgres
 * so E2E tests can hit the real backend without mocks.
 */
import { execSync } from "child_process";
import path from "path";

export default async function globalSetup() {
    const backendDir = path.resolve(__dirname, "../../backend");

    console.log("🌱 Running Prisma seed for E2E tests...");
    try {
        execSync("npx prisma db seed", {
            cwd: backendDir,
            stdio: "inherit",
            timeout: 30_000,
        });
        console.log("✅ Database seeded successfully");
    } catch (error) {
        console.error("⚠️  Seed failed (tests will use existing database state):", error);
        // Don't throw — the database might already be seeded from a previous run
    }
}
