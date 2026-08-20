# defter-api — Notes API (backend)

> Bu depo, Notes uygulamasının **backend** kısmını içerir (Node.js + Fastify + PostgreSQL).
> Frontend (`defter-web`) ayrı depodadır.

Sıfırdan geliştirilmiş, sade ve hızlı bir not alma uygulaması. Flatnotes kadar sade, Notion kadar karmaşık değil.

## Özellikler

- **Kullanıcı sistemi**: kayıt/giriş, her kullanıcı yalnızca kendi notlarını, klasörlerini ve etiketlerini görür
- Klasör ve etiket ile organize etme
- Markdown desteği: düzenleme / önizleme
- **LaTeX (KaTeX)**: inline `$...$` ve blok `$$...$$`
- Favori / pinleme
- **Güvenlik**: giriş denemeleri loglanır (IP/zaman/başarılı-başarısız), giriş bilgileri şifreli iletilir (AES-GCM + RSA-OAEP), scrypt parola hash'i, HMAC imzalı token, admin yönetimi

## Teknolojiler

- **Backend:** Node.js + Fastify + TypeScript + PostgreSQL (pg)
- **Eşzamanlı düzenleme:** y-websocket / ws (collab)
- **Dağıtım:** Tamamen Dockerize (`docker-compose`)

## Hızlı Başlangıç (Docker)

```bash
cp .env.example .env        # ilk seferde; DATABASE_URL ve AUTH_SECRET'i düzenleyin
./run.sh                    # veya: docker compose up --build -d
```

- API : http://localhost:29868 (`API_PORT` ile değiştirilebilir)

## Veritabanı (Harici PostgreSQL)

Uygulama kendi PostgreSQL servisini çalıştırmaz; `.env` içindeki **mevcut** PostgreSQL sunucunuza bağlanır:

```
DATABASE_URL=postgres://postgres:<şifre>@<host>:5432/notes
```

- `POSTGRES_DB` (ör. `notes`) sunucunuzda önceden oluşturulmuş olmalı: `CREATE DATABASE notes;`
- Tablolar ilk açılışta API tarafından otomatik oluşturulur (migration'lar `src/migrations/*.sql`, idempotent).

## Kullanıcı Sistemi ve Güvenlik

- Kayıt (`/api/auth/register`) ve giriş (`/api/auth/login`) HMAC ile imzalanmış token döner (30 gün geçerli).
- Parolalar `scrypt` ile tuzlanmış olarak saklanır (düz metin asla).
- **MITM koruması:** giriş/kayıt bilgileri sunucuya AES-GCM (simetrik) ile şifrelenir; AES anahtarı sunucunun RSA-OAEP genel anahtarıyla sarılır. Sunucu `GET /api/auth/public-key` ile genel anahtarı dağıtır.
- **Giriş logları:** başarılı/başarısız tüm giriş denemeleri IP + zaman + user-agent ile `auth_logs` tablosuna yazılır. Kullanıcı kendi loglarını (`/api/auth/me/logs`), admin tüm logları (`/api/admin/logs`) görür.
- **Admin yönetimi:** admin kullanıcıları yönetici yapıp düşürebilir, kullanıcıları engelleyebilir, tüm not içeriklerini/paylaşımlarını görür.
- Not, klasör ve etiketlerin tamamı kullanıcıya aittir; tüm sorgular `user_id` ile filtrelenir.
- Korunan uçlara token olmadan istek **401** döner; başka kullanıcının kaydına erişim **404** ile engellenir.
- **Önemli:** Üretimde `AUTH_SECRET` ortam değişkenini uzun, rastgele bir değere ayarlayın (`.env` içinde `AUTH_SECRET=...`). Ayarlanmazsa varsayılan sabit değer kullanılır — güvenlik açısından değiştirin.

## Yerel Geliştirme (Docker'sız, hot-reload)

```bash
npm install
npm run dev
```

Varsayılan `DATABASE_URL` (backend): `postgres://postgres:<şifre>@<host>:5432/notes`

## Proje Yapısı

```
├── docker-compose.yml          # API servisi (harici PostgreSQL)
├── .env                        # DB bağlantı bilgileri (gitignore'da)
├── run.sh                      # tek komutla ayağa kaldıran betik
└── src/
    ├── index.ts                # giriş: migration + listen
    ├── app.ts                  # Fastify kurulumu
    ├── db.ts                   # pg pool
    ├── migrate.ts              # SQL migration çalıştırıcı
    ├── auth.ts                 # register/login/me, scrypt hash, HMAC token, giriş loglama
    ├── crypto-keys.ts          # MITM koruması için RSA anahtar çifti
    ├── migrations/             # 001_init .. 007_auth_logs
    └── routes/
        ├── notes.ts            # CRUD + arama + filtreler + paylaşım + public share
        ├── folders.ts
        ├── tags.ts
        ├── friends.ts
        ├── admin.ts            # kullanıcı/not/rol/log yönetimi
        └── public.ts           # /share/:token
```

## API Özeti

| Yöntem | Yol | Açıklama |
| --- | --- | --- |
| GET | `/api/auth/public-key` | MITM koruması için RSA genel anahtarı |
| POST | `/api/auth/register` | Kayıt ol (`username`, `email`, `password` ≥ 8) → `{token, user}` |
| POST | `/api/auth/login` | Giriş yap → `{token, user}` |
| GET | `/api/auth/me` | Token'ı doğrula → `{user}` (Bearer) |
| GET | `/api/auth/me/logs` | Kullanıcının kendi giriş kayıtları |
| GET | `/api/notes?search=&folderId=&tagId=&view=pinned` | Listele + ara/filtrele |
| GET | `/api/notes/:id` | Tek not (etiketleriyle) |
| POST | `/api/notes` | Not oluştur |
| PATCH | `/api/notes/:id` | Not güncelle (`title`, `content`, `folderId`, `isPinned`, `tagIds`) |
| DELETE | `/api/notes/:id` | Not sil |
| POST/DELETE | `/api/notes/:id/share` | Herkese açık bağlantıyı aç/kapat |
| GET/POST | `/api/folders` | Klasör listele/oluştur |
| PATCH/DELETE | `/api/folders/:id` | Klasör yeniden adlandır/sil (notlar korunur) |
| GET/POST | `/api/tags` | Etiket listele/oluştur |
| DELETE | `/api/tags/:id` | Etiket sil |
| GET | `/api/admin/users` | Tüm kullanıcılar (admin) |
| GET | `/api/admin/notes` | Tüm notlar + paylaşım bilgileri (admin) |
| GET | `/api/admin/logs` | Tüm giriş kayıtları (admin) |
| PATCH | `/api/admin/users/:id/role` | Yönetici yap / düşür |
| GET | `/api/share/:token` | Herkese açık not (kimlik doğrulamasız) |

`/api/notes`, `/api/folders`, `/api/tags`, `/api/admin/*` uçlarının tamamı `Authorization: Bearer <token>` ister.

## Veritabanı

Migration'lar backend başlangıcında otomatik çalışır (idempotent). Şema `src/migrations/*.sql` içindedir:

- `folders`, `tags`, `notes`, `note_tags` (çoktan çoğa), `users`, `friendships`, `note_shares`, `auth_logs`
- `notes.updated_at` indeksi — son düzenlenen sıralaması için
- Notların klasörü silinince `folder_id` `NULL` olur, notlar korunur