-- Refuse to replace the key if historical data contains duplicates. This keeps
-- the migration from silently losing idempotency guarantees.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ProcessedEvent"
    GROUP BY "consumerName", "eventId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'ProcessedEvent contains duplicate consumerName/eventId pairs; deduplicate before migrating';
  END IF;
END
$$;

ALTER TABLE "ProcessedEvent"
  DROP CONSTRAINT "ProcessedEvent_pkey",
  DROP COLUMN "id";

ALTER TABLE "ProcessedEvent"
  RENAME COLUMN "createdAt" TO "processedAt";

ALTER TABLE "ProcessedEvent"
  ADD CONSTRAINT "ProcessedEvent_pkey"
  PRIMARY KEY ("consumerName", "eventId");
