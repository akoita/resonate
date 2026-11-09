-- #2601: a published remix held because its source stopped being remixable.
ALTER TABLE "Release" ADD COLUMN "sourceHoldReason" TEXT;
