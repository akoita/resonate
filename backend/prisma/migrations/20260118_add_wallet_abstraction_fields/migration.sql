ALTER TABLE "Wallet"
ADD COLUMN "accountType" TEXT NOT NULL DEFAULT 'local',
ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'local',
ADD COLUMN "ownerAddress" TEXT,
ADD COLUMN "entryPoint" TEXT,
ADD COLUMN "factory" TEXT,
ADD COLUMN "paymaster" TEXT,
ADD COLUMN "bundler" TEXT,
ADD COLUMN "salt" TEXT;
