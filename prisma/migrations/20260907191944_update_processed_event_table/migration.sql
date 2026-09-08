/*
  Warnings:

  - The primary key for the `ProcessedEvent` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `createdAt` on the `ProcessedEvent` table. All the data in the column will be lost.
  - You are about to drop the column `id` on the `ProcessedEvent` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ProcessedEvent" DROP CONSTRAINT "ProcessedEvent_pkey",
DROP COLUMN "createdAt",
DROP COLUMN "id",
ADD COLUMN     "processedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("consumerName", "eventId");
