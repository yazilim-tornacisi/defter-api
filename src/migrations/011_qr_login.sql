-- QR kod ile giriş: desktop login ekranı QR üretir, mobil uygulama tarar ve onaylar
CREATE TABLE IF NOT EXISTS pair_logins (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash   TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'completed')),
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  device_ua   TEXT,
  ip          INET
);

CREATE INDEX IF NOT EXISTS idx_pair_logins_expires_at ON pair_logins (expires_at);
CREATE INDEX IF NOT EXISTS idx_pair_logins_status ON pair_logins (status);
