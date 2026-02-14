-- AlterTable
ALTER TABLE "AgentConfig" ADD COLUMN     "stemTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];
