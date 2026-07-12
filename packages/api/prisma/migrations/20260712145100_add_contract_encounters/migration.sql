-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "encounters" JSONB NOT NULL DEFAULT '[]';
