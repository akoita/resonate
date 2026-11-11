-- #2614: the inverse pitch/tempo search records which change it undid before
-- the decode that matched. Null on every other stage.
ALTER TABLE "RemixWatermarkDetection" ADD COLUMN "shiftKind" TEXT;
ALTER TABLE "RemixWatermarkDetection" ADD COLUMN "shiftAmount" DOUBLE PRECISION;
