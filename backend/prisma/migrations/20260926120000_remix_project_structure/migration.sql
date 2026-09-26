-- Persist the Remix Studio structure blocks (remix-structure/v1) with the project (#1899).
ALTER TABLE "RemixProject" ADD COLUMN "structure" JSONB;
