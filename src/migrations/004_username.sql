ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;

-- Mevcut kullanıcılar için e-posta yerel kısmından benzersiz kullanıcı adı üret
DO $$
DECLARE
  u RECORD;
  base TEXT;
  candidate TEXT;
  n INT;
BEGIN
  FOR u IN SELECT id, email FROM users WHERE username IS NULL OR username = '' LOOP
    base := lower(split_part(u.email, '@', 1));
    base := regexp_replace(base, '[^a-z0-9_]', '', 'g');
    IF base = '' OR length(base) < 3 THEN
      base := 'user';
    END IF;
    base := left(base, 16);
    candidate := base;
    n := 2;
    WHILE EXISTS (SELECT 1 FROM users WHERE lower(username) = lower(candidate)) LOOP
      candidate := base || n::text;
      n := n + 1;
      IF n > 200 THEN
        candidate := base || floor(random() * 100000)::int::text;
        EXIT;
      END IF;
    END LOOP;
    UPDATE users SET username = candidate WHERE id = u.id;
  END LOOP;
END $$;

ALTER TABLE users ALTER COLUMN username SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username));