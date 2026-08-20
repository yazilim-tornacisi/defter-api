-- Genel (public) paylaşım linklerinin görüntülenme kayıtları
CREATE TABLE IF NOT EXISTS share_views (
  id         BIGSERIAL PRIMARY KEY,
  note_id    UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  viewed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip         INET,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_share_views_note_id ON share_views (note_id);
CREATE INDEX IF NOT EXISTS idx_share_views_viewed_at ON share_views (viewed_at DESC);