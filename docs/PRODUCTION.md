# TruckAI — Production

Bu hujjat production TruckAI qanday qurilganini tasvirlaydi. Qadamma-qadam
o'rnatish — [DEPLOYMENT.md](DEPLOYMENT.md). Nosozlik yuz berganda —
[ROLLBACK.md](ROLLBACK.md) va [DISASTER-RECOVERY.md](DISASTER-RECOVERY.md).

---

## 1. Arxitektura

```
                        Internet
                            │
                            ▼
                           DNS
                 app.<domain>   api.<domain>
                     │              │
                     ▼              ▼
              ┌────────────┐  ┌──────────────────────────┐
              │  Web (SPA) │  │  nginx  (TLS 1.2/1.3)    │
              │  Vercel    │  │  deploy/nginx.conf       │
              │ vercel.json│  │  · HTTP→HTTPS            │
              └────────────┘  │  · HSTS, CSP, XFO        │
                     │        │  · rate limit + 429      │
                     │  XHR   │  · /health faqat ichkarига│
                     └───────▶└──────────┬───────────────┘
                                         │ proxy_pass
                                         ▼
                              ┌─────────────────────┐
                              │  API — NestJS       │
                              │  node dist/main.js  │
                              │  NODE_ENV=production│
                              └──┬───────┬───────┬──┘
                                 │       │       │
                     ┌───────────┘       │       └───────────┐
                     ▼                   ▼                   ▼
             ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
             │ PostgreSQL 16│   │    Redis     │   │ MinIO / S3   │
             │ truckai_app  │   │ rate limits  │   │ hujjat, chek │
             │ (least priv) │   │ + sessiyalar │   │ private only │
             └──────────────┘   └──────────────┘   └──────────────┘
                     │
                     ▼
             ┌──────────────┐          ┌──────────────────────┐
             │  Backups     │          │  AI provider         │
             │ GPG AES-256  │          │  mock (default) yoki │
             │ + offsite    │          │  anthropic           │
             └──────────────┘          └──────────────────────┘
```

**Muhim:** AI provayder ixtiyoriy. `AI_PROVIDER=mock` bo'lganda tashqi tarmoq
chaqiruvi umuman yo'q va assistant baribir to'g'ri raqamlar bilan javob beradi
(`docs/AI-ARCHITECTURE.md`).

---

## 2. Komponentlar

| Komponent         | Nima                                                                                          | Holat yo'qolsa                                                        |
| ----------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Web**           | Vercel'dagi statik SPA. `apps/web/vercel.json` — CSP, HSTS, SPA rewrite, cache.               | Qayta deploy — holat yo'q                                             |
| **nginx**         | TLS tugatish, xavfsizlik sarlavhalari, edge rate limit, `/health` ni ichki tarmoqqa cheklash. | Konfiguratsiya repositoryda                                           |
| **API**           | NestJS, `node dist/main.js`. Stateless.                                                       | Qayta ishga tushiriladi                                               |
| **PostgreSQL 16** | **Yagona muhim stateful komponent.**                                                          | Backup'dan tiklanadi                                                  |
| **Redis**         | Rate-limit hisoblagichlari, refresh-token oilalari.                                           | Yo'qolsa: limitlar nolga qaytadi, foydalanuvchilar qayta login qiladi |
| **MinIO / S3**    | Chek fotolari, hujjatlar. Private bucket, signed URL.                                         | Backup alohida kerak                                                  |

---

## 3. Ma'lumotlar bazasi rollari (least privilege)

Ikki rol, `deploy/postgres-roles.sql` bilan yaratiladi:

| Rol                | Huquqi                                       | Kim ishlatadi            |
| ------------------ | -------------------------------------------- | ------------------------ |
| `truckai_migrator` | Schema egasi. DDL.                           | Faqat migration job (CI) |
| `truckai_app`      | `SELECT/INSERT/UPDATE/DELETE`. DDL **yo'q**. | API runtime              |

`truckai_app` `CREATE`, `ALTER`, `DROP` qila olmaydi va `_prisma_migrations`
jadvalini umuman ko'rmaydi. Ya'ni API'dagi hech qanday kod yo'li — va unga
qilingan hech qanday injection — schema'ni o'zgartira olmaydi.

Tekshirish:

```bash
psql "$DATABASE_URL" -c "create table x(i int);"   # → permission denied
psql "$DATABASE_URL" -c "drop table trips;"        # → must be owner
```

---

## 4. Environment

Shablon: `.env.production.example`. Haqiqiy fayl **hech qachon** repositoryga
tushmaydi (`.gitignore` bloklaydi) va `chmod 600` bo'lishi kerak.

Deploydan oldin majburiy:

```bash
sh deploy/check-production-env.sh /etc/truckai/.env.production
```

API o'zi ham start'da tekshiradi (`apps/backend/src/config/env.validation.ts`)
va quyidagilarda **ko'tarilmaydi**:

- placeholder secret (`REPLACE_ME`, `change-me`, …)
- `JWT_ACCESS_SECRET == JWT_REFRESH_SECRET`
- `WEB_URL` https emas yoki localhost/example.com
- `MINIO_USE_SSL=false` bo'lib, `MINIO_ENDPOINT` loopback emas
- parolsiz, loopback bo'lmagan `REDIS_URL`
- `TRUST_PROXY` aniq yozilmagan
- `AI_PROVIDER=anthropic` bo'lib, `AI_API_KEY` bo'sh

`TRUST_PROXY` uchun default yo'q: nginx orqasida `0` bo'lsa barcha so'rovlar
bitta IP'dan kelgandek ko'rinadi va bitta mijozning oqimi hammani bloklaydi;
proxy'siz `1` bo'lsa mijoz `X-Forwarded-For` ni soxtalashtirib limitlardan
o'tib ketadi. Ikkalasi ham qabul qilinadi — sukut saqlash qabul qilinmaydi.

---

## 5. Xavfsizlik holati

| Nazorat                                                             | Qayerda                                                                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| TLS 1.2/1.3, faqat forward-secrecy shifrlari, session ticket o'chiq | `deploy/nginx.conf`                                                                |
| HSTS, CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy     | nginx (edge — yagona manba, `proxy_hide_header` upstream nusxasini olib tashlaydi) |
| JSON javoblar **gzip qilinmaydi** (BREACH)                          | `gzip_types` da `application/json` yo'q                                            |
| Rate limiting: edge (nginx) + ilova (Redis, har foydalanuvchi)      | `common/throttle/`                                                                 |
| 429 → `Retry-After` + `{ success, error }` konverti                 | Ilova ham, edge ham                                                                |
| Tenant izolyatsiyasi                                                | Prisma client extension, har so'rovda `company_id`                                 |
| RBAC                                                                | `@Roles`, global `RolesGuard`                                                      |
| Audit log                                                           | Pul, kirish, reys — har o'zgarish                                                  |
| Structured log, sirlar maskalanadi                                  | `common/logging/redact.ts`                                                         |
| Fayl yuklash: magic bytes, hajm, private bucket, signed URL         | `modules/files/`                                                                   |

Batafsil: [SECURITY.md](SECURITY.md).

---

## 6. Kuzatuv

| Endpoint                   | Nima aytadi                                                        |
| -------------------------- | ------------------------------------------------------------------ |
| `GET /api/v1/health/live`  | Process tirikmi. Hech qanday bog'liqlikka tegmaydi.                |
| `GET /api/v1/health/ready` | PostgreSQL + Redis + MinIO javob beradimi. 503 = trafik yubormang. |

Ikkalasi ham nginx'da faqat ichki tarmoqqa ochiq.

Har so'rov bitta JSON qatorini yozadi: `requestId`, `method`, `route`
(shablon, URL emas), `statusCode`, `durationMs`, `userId`, `companyId`.
Batafsil: [MONITORING.md](MONITORING.md).

---

## 7. Backup

```bash
BACKUP_PASSPHRASE=… sh deploy/backup.sh          # har kuni
BACKUP_PASSPHRASE=… sh deploy/backup-verify.sh   # har hafta — haqiqiy restore
```

`backup-verify.sh` backup'ni **haqiqatan tiklaydi**: alohida bazaga restore
qiladi, qator sonlarini va pul yig'indilarini manba bilan solishtiradi,
migration tarixi va tenant-xavfsizlik indekslarini tekshiradi. Tekshirilmagan
backup — backup emas, taxmin.

Batafsil: [DISASTER-RECOVERY.md](DISASTER-RECOVERY.md).

---

## 8. Ishga tushirishdan oldingi ro'yxat

[PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md).
