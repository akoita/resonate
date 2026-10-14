-- #2023: mark Wallet rows whose address was written by sign-in (/auth/verify).
-- WalletService.refreshWallet never overwrites a verified address with a
-- provider-derived one.
ALTER TABLE "Wallet" ADD COLUMN "addressVerifiedAt" TIMESTAMP(3);

-- Conservative backfill: only mark rows where the evidence is unambiguous.
-- Addresses are NOT rewritten here; a row already overwritten by a derived
-- address is corrected (and marked verified) by the user's next sign-in.
UPDATE "Wallet" AS w
SET "addressVerifiedAt" = CURRENT_TIMESTAMP
WHERE w."addressVerifiedAt" IS NULL
  AND (
    -- Wallet/passkey accounts whose User.id is the smart-account address.
    w."address" = lower(w."userId")
    -- Or a passkey identity of the same user last signed in from this address.
    OR EXISTS (
      SELECT 1
      FROM "PasskeyIdentity" AS p
      WHERE p."userId" = w."userId"
        AND p."lastWalletAddress" = w."address"
    )
  );
