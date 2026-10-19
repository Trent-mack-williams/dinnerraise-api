/*
  Warnings:

  - A unique constraint covering the columns `[stripeSessionId]` on the table `Seat` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "SeatStatus" ADD VALUE 'AWAITING_PAYMENT';

-- AlterTable
ALTER TABLE "Seat" ADD COLUMN     "stripeSessionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Seat_stripeSessionId_key" ON "Seat"("stripeSessionId");
