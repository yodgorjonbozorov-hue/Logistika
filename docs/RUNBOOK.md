# Runbook — asosiy alertlar va ular bilan nima qilish

Har alert uchun: **nima ko'rinadi → nimani tekshirasiz → nima qilasiz**.
Barcha buyruqlar `/opt/truckcontrol` ichidan, `docker compose -f docker-compose.prod.yml`
prefiksi bilan (quyida `dc` deb qisqartirilgan).

## Diagnostika minimumi

```bash
alias dc='docker compose -f docker-compose.prod.yml'
dc ps                                   # nima ishlayapti
curl -fsS localhost/api/v1/health/ready  # qaysi bog'liqlik yiqilgan
dc logs --tail=200 backend               # JSON loglar (requestId, userId, duration)
dc logs --tail=100 postgres
```

Har javobda `x-request-id` header'i bor. Foydalanuvchi shikoyat qilsa shu id'ni so'rang:

```bash
dc logs backend | grep '<request-id>'
```

---

## 1. 5xx xatolar 1% dan oshdi

**Ko'rinadi**: Sentry'da yangi issue oqimi yoki loglarda `"level":50` ko'payishi.

**Tekshiring**

```bash
dc logs --tail=500 backend | grep '"level":50' | tail -20
curl -fsS localhost/api/v1/health/ready
```

**Qilinadigan ish**

1. `health/ready` 503 bo'lsa → 2/3/4-bo'limga o'ting (bog'liqlik muammosi).
2. Bitta endpoint'da to'planganmi? Oxirgi deploy bilan bog'liq bo'lsa —
   `docs/DEPLOYMENT.md` §7 (rollback).
3. Migratsiyadan keyin boshlangan bo'lsa — sxema va kod mos emas; migratsiyani
   qo'llab, backend'ni qayta ko'taring: `dc up -d migrate && dc restart backend`.

## 2. Baza ulanish pool'i to'la / so'rovlar sekin

**Ko'rinadi**: `duration` maydonlari sakraydi, `Timed out fetching a new connection`.

**Tekshiring**

```bash
dc exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"
dc exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT pid, now()-query_start AS age, left(query,80) FROM pg_stat_activity
      WHERE state='active' ORDER BY age DESC LIMIT 5;"
```

**Qilinadigan ish**

1. Bitta uzun so'rov bo'lsa (odatda GPS tarixi yoki hisobot) — `pg_cancel_backend(pid)`.
2. Pool doim to'la bo'lsa: `DATABASE_URL`ga `?connection_limit=N` qo'shing (default
   Prisma'da CPU×2+1). RLS tufayli har tenant so'rovi tranzaksiya — bu ulanishlarni
   uzoqroq band qiladi, shuni hisobga oling.
3. Takrorlansa — pgbouncer (TASK-4.6 doirasida o'lchanadi).

## 3. Redis yiqildi

**Ko'rinadi**: `health/ready` da `redis: down`; rate limiting ishlamaydi.

**Tekshiring**: `dc logs --tail=50 redis`, `dc exec redis redis-cli ping`.

**Qilinadigan ish**: `dc restart redis`. **Diqqat**: Redis yo'q bo'lsa throttler xato
beradi — ya'ni login/SMS endpointlari ishlamay qolishi mumkin. Bu ataylab:
rate limiting'siz ishlagandan ko'ra to'xtagan yaxshi.

## 4. MinIO / fayl yuklash ishlamayapti

**Ko'rinadi**: `health/ready` da `storage: down`, haydovchilar «foto yuborilmadi» deydi.

**Tekshiring**

```bash
dc logs --tail=50 minio
dc exec minio mc ls local/"$MINIO_BUCKET" | head
df -h                      # disk to'lgan bo'lishi mumkin
```

**Qilinadigan ish**: disk to'lgan bo'lsa 5-bo'limga; aks holda `dc restart minio`.
Muhim: **hodisalar yo'qolmaydi** — mobil ilova fotosiz hodisani `synced` qilmaydi
(TASK-1.2/5.4), navbatda qoladi va tiklangach yuboriladi.

## 5. Disk 80% dan oshdi

**Tekshiring**

```bash
df -h
du -sh /var/lib/docker/volumes/* | sort -h | tail
```

**Qilinadigan ish** (tartib bilan)

1. Eski zaxiralar: `BACKUP_RETENTION_DAYS`ni kamaytiring yoki tashqi joyga ko'chiring.
2. GPS arxivi: `gps_tracks_archive` cheksiz o'sadi (M-9 — TASK-4.4 da retention qo'shiladi).
3. Docker: `docker image prune -a`, `docker builder prune`.
4. Orphan fayllar allaqachon kunlik tozalanadi (TASK-2.7).

## 6. Zaxira muvaffaqiyatsiz

**Ko'rinadi**: `dc logs backup | grep FAILURE`.

**Tekshiring**

```bash
dc logs --tail=100 backup
dc exec backup ls -lh /backups | tail
```

**Qilinadigan ish**: darhol qo'lda oling —
`dc exec backup /scripts/backup.sh`. Sabab odatda disk yoki MinIO credential'lari.
**Ikki kun ketma-ket muvaffaqiyatsiz zaxira — incident.**

## 7. Ko'p 429 (rate limit)

**Ko'rinadi**: foydalanuvchilar «kira olmayapman» deydi, loglarda `RATE_LIMIT_EXCEEDED`.

**Tekshiring**: bitta IP'danmi (hujum yoki NAT ortidagi butun ofis)?

```bash
dc logs backend | grep RATE_LIMIT_EXCEEDED | tail -20
```

**Qilinadigan ish**: agar bitta firma NAT ortida bo'lsa va login limiti (5/daq/IP) yetmasa —
limitni `auth.controller.ts`da oshirish kerak, lekin **identifier limitini emas** (u
brute-force'ga qarshi). Nginx `X-Forwarded-For`ni to'g'ri uzatayotganini tekshiring
(`nginx/nginx.conf`), aks holda hamma bitta IP'dek ko'rinadi.

## 8. Obuna/hisob muammolari

- 402 `SUBSCRIPTION_EXPIRED` yoki 403 `COMPANY_INACTIVE` — SUPERADMIN
  `PATCH /admin/companies/:id` bilan `subscriptionUntil`ni uzaytiradi.
- 403 `AUTH_ACCOUNT_LOCKED` — 10 xato paroldan keyin 15 daqiqa. Kutish yoki parolni
  tiklash (`/forgot-password`) lockout'ni bekor qiladi.
- `AUTH_REFRESH_REUSED` ko'p bo'lsa: bu token o'g'irlanishi belgisi bo'lishi mumkin.
  `audit_logs` da `REFRESH_REUSE_DETECTED` yozuvlarini foydalanuvchi bo'yicha ko'ring.

## Alert sozlash (hozircha yo'q)

Quyidagilar uchun alert qo'yish tavsiya etiladi (Sentry + oddiy uptime monitor yetarli):

| Alert              | Shart                                   |
| ------------------ | --------------------------------------- |
| API o'chdi         | `/api/v1/health` 2 daqiqa javob bermadi |
| Bog'liqlik yiqildi | `/api/v1/health/ready` 503              |
| 5xx portlashi      | 5 daqiqada > 1% so'rov                  |
| Disk               | > 80%                                   |
| Zaxira             | 26 soat ichida yangi fayl yo'q          |
