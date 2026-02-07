-- AlterTable
ALTER TABLE "Stem" ADD COLUMN     "encryptionMetadata" TEXT,
ADD COLUMN     "isEncrypted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storageProvider" TEXT NOT NULL DEFAULT 'local';
