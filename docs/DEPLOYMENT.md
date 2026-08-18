# Deployment — bitta VPS

Ushbu hujjat TruckControl AI'ni bitta serverga (Ubuntu 22.04+, 4 vCPU / 8 GB RAM / 100 GB SSD)
Docker Compose bilan o'rnatish tartibini beradi.

## 1. Talablar

- Docker Engine 24+ va Docker Compose plugin
- Domen (masalan `app.truckcontrol.uz`) A-yozuvi server IP'siga yo'naltirilgan
- TLS sertifikati (Let's Encrypt tavsiya etiladi)

## 2. Kodni olish va env

```bash
git clone <repo> /opt/truckcontrol && cd /opt/truckcontrol
cp .env.example .env
```

`.env` da **majburiy** to'ldiriladigan qiymatlar:

| O'zgaruvchi                                | Izoh                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `NODE_ENV=production`                      | Yo'q bo'lsa app ko'tarilmaydi                                          |
| `POSTGRES_USER/PASSWORD/DB`                | Baza (compose shu qiymatlar bilan konteyner ko'taradi)                 |
| `DATABASE_URL`                             | `postgresql://<user>:<pass>@postgres:5432/<db>?schema=public`          |
| `REDIS_URL`                                | `redis://redis:6379`                                                   |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`  | **≥ 32 belgi, bir-biridan farqli** (`openssl rand -hex 32`)            |
| `WEB_URL`                                  | `https://app.truckcontrol.uz` — `https://` majburiy                    |
| `MINIO_ENDPOINT=minio`, `MINIO_PORT=9000`  | Ichki (Docker tarmog'i) manzil                                         |
| `MINIO_PUBLIC_ENDPOINT`                    | Brauzer ochadigan manzil (presigned URL shu bilan imzolanadi)          |
| `MINIO_ROOT_USER/PASSWORD`, `MINIO_BUCKET` | Obyekt saqlash                                                         |
| `MINIO_USE_SSL=true`                       | Production'da majburiy                                                 |
| `SEED_SUPERADMIN_EMAIL/PASSWORD`           | Birinchi SUPERADMIN (seed uchun; keyin `.env`dan olib tashlash mumkin) |

Production'da `NODE_ENV=production` bo'lsa `env.validation.ts` qo'shimcha tekshiradi: qisqa yoki
bir xil JWT sirlari, `MINIO_USE_SSL != true`, `http://` bilan boshlanuvchi `WEB_URL` — app
ishga tushmaydi. Bu ataylab: noto'g'ri sozlangan holda ishlaganidan ko'ra to'xtagani yaxshi.

## 3. TLS

```bash
mkdir -p nginx/certs
# Let's Encrypt (certbot standalone yoki webroot: /var/www/certbot)
certbot certonly --webroot -w /var/www/certbot -d app.truckcontrol.uz
cp /etc/letsencrypt/live/app.truckcontrol.uz/fullchain.pem nginx/certs/
cp /etc/letsencrypt/live/app.truckcontrol.uz/privkey.pem  nginx/certs/
```

Sertifikat yangilangach `docker compose -f docker-compose.prod.yml restart nginx`.

## 4. Ishga tushirish

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Nima bo'ladi:

1. `postgres`, `redis`, `minio` ko'tariladi va healthcheck'dan o'tadi;
2. `migrate` — bir martalik servis, `prisma migrate deploy` bajaradi va to'xtaydi;
3. `backend` faqat migratsiya **muvaffaqiyatli tugagach** ishga tushadi
   (`service_completed_successfully`);
4. `web` (nginx + statik build) va tashqi `nginx` (TLS, `/api` proxy) ko'tariladi.

Migratsiya alohida servis bo'lgani muhim: backend replikalarini ko'paytirganda ular
bir vaqtda `migrate deploy` qilib bazani buzmasligi kerak.

### Birinchi SUPERADMIN

```bash
docker compose -f docker-compose.prod.yml run --rm migrate npx prisma db seed
```

Production'da seed **faqat** SUPERADMIN yaratadi (demo ma'lumot yaratilmaydi).
Kirgach: firma yaratish → OWNER foydalanuvchi qo'shish → `.env` dagi
`SEED_SUPERADMIN_PASSWORD`ni o'chirish.

## 5. Health va monitoring

| Endpoint                   | Ma'nosi                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/health`       | Liveness — process tirikmi (konteyner restart siyosati uchun)                                                                                   |
| `GET /api/v1/health/ready` | Readiness — Postgres `SELECT 1`, Redis `PING`, MinIO `bucketExists`. Biror bog'liqlik yiqilsa **503** va qaysi biri yiqilgani javobda ko'rinadi |

Load balancer/monitoring `ready`ni so'rashi kerak: bazasi o'lgan instance'ga trafik yuborish
bitta nosozlikni ikkitaga aylantiradi.

## 6. Yangilash (rolling update)

```bash
cd /opt/truckcontrol
git pull
docker compose -f docker-compose.prod.yml build backend web
docker compose -f docker-compose.prod.yml up -d migrate   # avval migratsiya
docker compose -f docker-compose.prod.yml up -d backend web nginx
docker compose -f docker-compose.prod.yml ps
```

## 7. Rollback

Migratsiyalar **oldinga** yo'naltirilgan (Prisma `migrate deploy` down-migration bermaydi).
Shuning uchun tartib:

1. **Kodni orqaga qaytarish** (sxema o'zgarmagan bo'lsa — eng oson yo'l):
   ```bash
   git checkout <oldingi-tag>
   docker compose -f docker-compose.prod.yml up -d --build backend web
   ```
2. **Sxema o'zgargan bo'lsa**: avval bazani zaxiradan tiklash, keyin eski kodni ko'tarish
   (tiklash tartibi — `docs/DISASTER-RECOVERY.md`, TASK-2.8).
3. Har deploy oldidan zaxira olish shart — pastdagi bo'limga qarang.

> **Qoida:** buzuvchi migratsiyani ikki bosqichda chiqaring (avval qo'shimcha ustun/jadval,
> keyingi relizda eskisini olib tashlash). Shunda rollback kodni qaytarish bilan cheklanadi.

## 8. Zaxira (backup)

Avtomatik `pg_dump` cron'i, retention va tiklash mashqi — **TASK-2.8** doirasida
(`docs/DISASTER-RECOVERY.md`). Hozircha qo'lda:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > backup-$(date +%F).sql.gz
```

## 9. Baza rollari va RLS (MAJBURIY)

PostgreSQL Row-Level Security (TASK-2.1) ikki xil rol talab qiladi:

| Rol                     | Kim ishlatadi                 | Huquq                                                   |
| ----------------------- | ----------------------------- | ------------------------------------------------------- |
| `truckcontrol_migrator` | `migrate` servisi, seed       | `BYPASSRLS` — migratsiya va bootstrap tenant'lararo     |
| `truckcontrol_app`      | `backend` (tenant so'rovlari) | `BYPASSRLS` **yo'q**, superuser emas, jadval egasi emas |

```bash
psql "$ADMIN_DATABASE_URL" \
  -v migrator_password="'...'" -v app_password="'...'" -v db=truckcontrol \
  -f scripts/create-db-roles.sql
```

Keyin `.env`:

```
DATABASE_URL=postgresql://truckcontrol_migrator:...@postgres:5432/truckcontrol?schema=public
DATABASE_URL_APP=postgresql://truckcontrol_app:...@postgres:5432/truckcontrol?schema=public
```

- `DATABASE_URL` — migratsiya, seed va tenant'dan tashqari operatsiyalar (login qidiruvi,
  SUPERADMIN, health).
- `DATABASE_URL_APP` — `forCompany()` orqali ketadigan **barcha** tenant so'rovlari. Har so'rov
  `set_config('app.company_id', <uuid>, true)` bilan tranzaksiya ichida bajariladi.

Application roli hech qachon `BYPASSRLS` bo'lmasligi kerak: aks holda RLS himoya qatlami
(ARCHITECTURE.md #3) shunchaki o'chib qoladi. Backend buni **start'da tekshiradi**:
`NODE_ENV=production` bo'lganda tenant ulanishi RLS'ni chetlab o'ta olsa — app ko'tarilmaydi.
Dev'da (baza egasi sifatida ulanish) faqat ogohlantirish yoziladi.

> **Eslatma:** `superuser` roli RLS'ni **har doim** chetlab o'tadi (`FORCE` bo'lsa ham).
> `truckcontrol_app` superuser bo'lmasligi shart.

---

## 10. Ulanish puli va gorizontal kengayish (TASK-4.6)

`DATABASE_URL` da `connection_limit` **aniq yozilishi kerak**. Ko'rsatilmasa
Prisma `num_cpus * 2 + 1` ulanish oladi — bitta instansiyada xavfsiz, lekin
instansiyalar soni ko'paygach bu son ular soniga ko'payadi va Postgres'ning
`max_connections` (standart 100) ga urilishi mumkin. Urilganda xato «baza
sekin» emas, «ulanish yo'q» bo'lib keladi va **hamma so'rov** yiqiladi.

```
DATABASE_URL=postgresql://...?schema=public&connection_limit=10&pool_timeout=20
```

Hisob: `instansiyalar × connection_limit + zaxira (migratsiya, psql, monitoring)`
**<** `max_connections`. Uchtadan ortiq instansiya bo'lsa — **pgbouncer**
(transaction pooling), u holda `connection_limit` pgbouncer'ga, `max_connections`
esa bazaga tegishli bo'ladi.

> **Diqqat:** pgbouncer'ning `transaction` rejimida sessiya darajasidagi
> holat yo'qoladi. RLS bizda `SET LOCAL` bilan **tranzaksiya ichida**
> o'rnatiladi (ARCHITECTURE.md §3), shuning uchun transaction pooling xavfsiz —
> lekin `session` rejimiga o'tilsa buni qayta tekshirish kerak.

Cron'lar TASK-4.4 dan beri distributed lock ostida, ya'ni ikkinchi va uchinchi
instansiya kechasi bir xil ishni takrorlamaydi. Sessiya holati Redis'da, ya'ni
API stateless — kengaytirishga to'sqinlik qiladigan narsa qolmadi.

O'lchangan raqamlar va to'yinish nuqtasi — `docs/PERFORMANCE.md`.
