ALTER TABLE "Account"
ADD COLUMN "fraudFlaggedAt" TIMESTAMPTZ(6);

ALTER TABLE "Transaction"
ADD COLUMN "authorizedAt" TIMESTAMPTZ(6);

CREATE TABLE "FraudSignal" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "signalValue" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "observedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FraudSignal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnalyticsMetric" (
    "id" TEXT NOT NULL,
    "bucketStart" TIMESTAMPTZ(6) NOT NULL,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "completedAmount" BIGINT NOT NULL DEFAULT 0,
    "finalizedCount" INTEGER NOT NULL DEFAULT 0,
    "finalizedAmount" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "AnalyticsMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FraudSignal_signalType_signalValue_transactionId_key"
ON "FraudSignal"("signalType", "signalValue", "transactionId");
CREATE INDEX "FraudSignal_signalType_signalValue_observedAt_idx"
ON "FraudSignal"("signalType", "signalValue", "observedAt");
CREATE INDEX "FraudSignal_accountId_observedAt_idx"
ON "FraudSignal"("accountId", "observedAt");
CREATE UNIQUE INDEX "AnalyticsMetric_bucketStart_key"
ON "AnalyticsMetric"("bucketStart");

ALTER TABLE "FraudSignal"
ADD CONSTRAINT "FraudSignal_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FraudSignal"
ADD CONSTRAINT "FraudSignal_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "Transaction"("transactionId") ON DELETE CASCADE ON UPDATE CASCADE;
