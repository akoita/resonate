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

    // #1869: the web app no longer dresses an empty campaign list up with
    // built-in sample campaigns, so the Shows specs need real campaigns in the
    // database. Load the canonical sample show fixtures (idempotent upsert)
    // through the backend fixture script so E2E exercises the real API path.
    console.log("🎤 Loading sample show campaign fixtures for E2E tests...");
    try {
        execSync("npm run fixtures:shows", {
            cwd: backendDir,
            stdio: "inherit",
            timeout: 120_000,
            env: {
                ...process.env,
                // Explicit opt-in: this harness database is disposable.
                ALLOW_SAMPLE_SHOW_FIXTURES: "true",
                // Fixture artwork is written to the backend's local storage,
                // never to a shared bucket.
                STORAGE_PROVIDER: "local",
            },
        });
        console.log("✅ Sample show campaigns loaded");
    } catch (error) {
        console.error("⚠️  Show fixtures failed (Shows specs will see no campaigns):", error);
        // Don't throw — non-Shows specs don't depend on campaign fixtures
    }
}
