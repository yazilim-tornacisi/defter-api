ALTER TABLE notes ADD COLUMN IF NOT EXISTS share_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_share_token ON notes (share_token) WHERE share_token IS NOT NULL;