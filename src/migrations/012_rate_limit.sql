-- Rate limit blokları — developer panelinden izlenir
-- Her engellenen istek için günlük sayaçlar (route bazlı + IP bazlı) tutulur

CREATE TABLE IF NOT EXISTS rate_limit_daily (
  day    DATE NOT NULL,
  method TEXT NOT NULL,
  route  TEXT NOT NULL,
  count  BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, method, route)
);

CREATE TABLE IF NOT EXISTS rate_limit_ip_daily (
  day DATE NOT NULL,
  ip  INET NOT NULL,
  count BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, ip)
);
