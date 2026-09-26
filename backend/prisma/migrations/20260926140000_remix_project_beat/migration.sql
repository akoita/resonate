-- Persist the Remix Studio beat maker recipe (remix-beat/v1) with the project (#1902).
ALTER TABLE "RemixProject" ADD COLUMN "beat" JSONB;
