-- Kullanıcı başına not ve not içerik boyutu limitleri (kötüye kullanım koruması)

-- Genel (varsayılan) limitler; yönetici ayarlar ekranından değiştirilebilir
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES ('max_notes_per_user', '2000')
  ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('max_note_content_length', '200000')
  ON CONFLICT (key) DO NOTHING;

-- Kullanıcıya özel sınırlar (NULL = genel varsayılanı kullanır)
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_notes INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_note_chars INTEGER;