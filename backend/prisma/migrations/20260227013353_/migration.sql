/*
  Warnings:

  - You are about to drop the column `pubKeyX` on the `Wallet` table. All the data in the column will be lost.
  - You are about to drop the column `pubKeyY` on the `Wallet` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Wallet" DROP COLUMN "pubKeyX",
DROP COLUMN "pubKeyY";
