//
// Inlined V36 SQL. Mirrored from V36__collaborator_expiry.sql in this
// directory; the .sql copy is the human-readable source for review and
// for direct execution via psql; the .ts copy is what callers consume.
//
// Adds the `expires_at TIMESTAMPTZ NULL` column + partial index for
// time-bounded grants. NULL = permanent (default). The background
// prune job in account-service polls `expires_at < now()` and
// removes expired rows, emitting `grant_expired` audit events.
//
// DSGVO note: this is the schema half of the Datensparsamkeit
// (Art. 5 Abs. 1 lit. e) workstream — guest/external access can now
// carry a hard end-of-life that requires no manual cleanup.
//

export const V36_SQL = `
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'collaborator'
  ) THEN
    ALTER TABLE collaborator
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;

    CREATE INDEX IF NOT EXISTS idx_collaborator_expires
      ON collaborator (expires_at)
      WHERE expires_at IS NOT NULL;
  END IF;
END $$;
`
