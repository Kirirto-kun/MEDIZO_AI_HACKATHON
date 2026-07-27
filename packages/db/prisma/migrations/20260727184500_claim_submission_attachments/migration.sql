-- Claim uploaded files to one submission message so attachment IDs cannot be
-- reused or later attached to a catalog case.
BEGIN;

ALTER TABLE "CaseAttachment"
ADD COLUMN "submissionMessageId" TEXT;

CREATE INDEX "CaseAttachment_submissionMessageId_idx"
ON "CaseAttachment"("submissionMessageId");

ALTER TABLE "CaseAttachment"
ADD CONSTRAINT "CaseAttachment_submissionMessageId_fkey"
FOREIGN KEY ("submissionMessageId")
REFERENCES "CaseSubmissionMessage"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- Historical submission attachments were stored only as JSON objects on
-- CaseSubmissionMessage.attachments. Refuse an ambiguous/conflicting
-- migration rather than silently assigning one physical upload to the
-- wrong owner, then backfill the new relational claim for every valid ID.
DO $$
BEGIN
  IF EXISTS (
    SELECT extracted."attachmentId"
    FROM (
      SELECT
        message.id AS "messageId",
        element ->> 'attachmentId' AS "attachmentId"
      FROM "CaseSubmissionMessage" AS message
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(message.attachments) = 'array'
            THEN message.attachments
          ELSE '[]'::jsonb
        END
      ) AS element
      WHERE element ? 'attachmentId'
    ) AS extracted
    WHERE extracted."attachmentId" IS NOT NULL
    GROUP BY extracted."attachmentId"
    HAVING COUNT(DISTINCT extracted."messageId") > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill CaseAttachment: one attachmentId appears in multiple submission messages';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CaseAttachment" AS attachment
    JOIN (
      SELECT DISTINCT element ->> 'attachmentId' AS "attachmentId"
      FROM "CaseSubmissionMessage" AS message
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(message.attachments) = 'array'
            THEN message.attachments
          ELSE '[]'::jsonb
        END
      ) AS element
      WHERE element ? 'attachmentId'
    ) AS extracted
      ON extracted."attachmentId" = attachment.id
    WHERE attachment."caseId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill CaseAttachment: a submission attachment is already claimed by a case';
  END IF;
END $$;

WITH extracted AS (
  SELECT DISTINCT
    message.id AS "messageId",
    element ->> 'attachmentId' AS "attachmentId"
  FROM "CaseSubmissionMessage" AS message
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(message.attachments) = 'array'
        THEN message.attachments
      ELSE '[]'::jsonb
    END
  ) AS element
  WHERE element ? 'attachmentId'
)
UPDATE "CaseAttachment" AS attachment
SET "submissionMessageId" = extracted."messageId"
FROM extracted
WHERE attachment.id = extracted."attachmentId"
  AND attachment."caseId" IS NULL;

ALTER TABLE "CaseAttachment"
ADD CONSTRAINT "CaseAttachment_single_owner_check"
CHECK (NOT ("caseId" IS NOT NULL AND "submissionMessageId" IS NOT NULL));

COMMIT;
