-- Giriş denemeleri (başarılı / başarısız) kaydı
CREATE TABLE IF NOT EXISTS auth_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  identifier  TEXT NOT NULL,
  success     BOOLEAN NOT NULL,
  ip          INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_logs_user_id ON auth_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_logs_created_at ON auth_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_logs_success ON auth_logs (success);