-- Grid correction (#2539): the artist's tempo and first downbeat for a remix
-- project. Null keeps the measured grid.
ALTER TABLE "RemixProject" ADD COLUMN "gridOverride" JSONB;
