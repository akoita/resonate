-- Persist the Remix Studio shared effects recipe (remix-fx/v1) with the project (#1897).
ALTER TABLE "RemixProject" ADD COLUMN "effects" JSONB;
