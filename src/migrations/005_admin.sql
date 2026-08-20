ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;

-- Belirtilen e-posta sahibini yönetici yap
UPDATE users SET is_admin = true WHERE lower(email) = 'daddydemir@daddydemir.dev';

CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users (is_admin);
CREATE INDEX IF NOT EXISTS idx_users_banned_at ON users (banned_at);