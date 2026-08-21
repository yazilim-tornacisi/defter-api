-- Developer rolü + API metrikleri
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_developer BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_users_is_developer ON users (is_developer);

-- Endpoint çağrıları: günlük kovalara sayılır; toplamlar SUM(count) ile alınır
CREATE TABLE IF NOT EXISTS endpoint_metrics (
  method TEXT   NOT NULL,
  route  TEXT   NOT NULL,
  day    DATE   NOT NULL DEFAULT CURRENT_DATE,
  count  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (method, route, day)
);
