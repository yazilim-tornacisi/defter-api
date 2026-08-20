#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Hata: Docker bulunamadı. Önce Docker'ı kurun." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Hata: 'docker compose' (v2) bulunamadı." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠  .env oluşturuldu (.env.example kopyalandı). DATABASE_URL ve AUTH_SECRET değerlerini düzenleyin."
fi

echo "Building ve başlatılıyor (defter-api)…"
docker compose up --build -d

API_PORT="${API_PORT:-29868}"

echo
echo "✓ defter-api çalışıyor:"
echo "    API : http://localhost:${API_PORT}"
echo
echo "  Canlı loglar : docker compose logs -f"
echo "  Durdur       : docker compose down"
echo "  Yeniden başlat: $0"