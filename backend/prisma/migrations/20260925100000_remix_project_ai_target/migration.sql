-- Persist the Remix Studio variation AI target with the project (#1882).
ALTER TABLE "RemixProject" ADD COLUMN "aiTarget" JSONB;
