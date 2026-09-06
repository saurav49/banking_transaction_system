/*
  Warnings:

  - The values [COMPLETED] on the enum `OutboxEventStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `event` on the `OutboxEvent` table. All the data in the column will be lost.
  - Added the required column `eventType` to the `OutboxEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `eventVersion` to the `OutboxEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `partitionKey` to the `OutboxEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `topic` to the `OutboxEvent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `transactionId` to the `OutboxEvent` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OutboxEventStatus_new" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED');
ALTER TABLE "public"."OutboxEvent" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "OutboxEvent" ALTER COLUMN "status" TYPE "OutboxEventStatus_new" USING ("status"::text::"OutboxEventStatus_new");
ALTER TYPE "OutboxEventStatus" RENAME TO "OutboxEventStatus_old";
ALTER TYPE "OutboxEventStatus_new" RENAME TO "OutboxEventStatus";
DROP TYPE "public"."OutboxEventStatus_old";
ALTER TABLE "OutboxEvent" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- DropIndex
DROP INDEX "OutboxEvent_status_id_idx";

-- AlterTable
ALTER TABLE "OutboxEvent" DROP COLUMN "event",
ADD COLUMN     "eventType" TEXT NOT NULL,
ADD COLUMN     "eventVersion" INTEGER NOT NULL,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "partitionKey" TEXT NOT NULL,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "topic" TEXT NOT NULL,
ADD COLUMN     "transactionId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "consumerName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboxEvent_transactionId_idx" ON "OutboxEvent"("transactionId");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_nextAttemptAt_createdAt_idx" ON "OutboxEvent"("status", "nextAttemptAt", "createdAt");
