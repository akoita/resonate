-- Signup faucet idempotency records.
CREATE TABLE "SignupFaucetAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'signup-sepolia-faucet',
    "amountWei" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "txHash" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignupFaucetAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignupFaucetAttempt_signupFaucetAttempt_identity_key"
    ON "SignupFaucetAttempt"("userId", "walletAddress", "chainId", "purpose");

CREATE INDEX "SignupFaucetAttempt_walletAddress_chainId_idx"
    ON "SignupFaucetAttempt"("walletAddress", "chainId");
