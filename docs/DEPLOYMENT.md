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

| O'zgaruvchi                              | Izoh                                                       |
| ---------------------------------------- | ---------------------------------------------------------- |
| `NODE_ENV=production`                    | Yo'q bo'lsa app ko'tarilmaydi                              |
| `POSTGRES_USER/PASSWORD/DB`              | Baza (compose shu qiymatlar bilan konteyner ko'taradi)     |
| `DATABASE_URL`                           | `postgresql://<user>:<pass>@postgres:5432/<db>?schema=public` |
| `REDIS_URL`                              | `redis://redis:6379`                                        |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`| **≥ 32 belgi, bir-biridan farqli** (`openssl rand -hex 32`) |
| `WEB_URL`                                | `https://app.truckcontrol.uz` — `https://` majburiy         |
| `MINIO_ENDPOINT=minio`, `MINIO_PORT=9000`| Ichki (Docker tarmog'i) manzil                              |
| `MINIO_PUBLIC_ENDPOINT`                  | Brauzer ochadigan manzil (presigned URL shu bilan imzolanadi) |
| `MINIO_ROOT_USER/PASSWORD`, `MINIO_BUCKET` | Obyekt saqlash                                            |
| `MINIO_USE_SSL=true`                     | Production'da majburiy                                      |
| `SEED_SUPERADMIN_EMAIL/PASSWORD`         | Birinchi SUPERADMIN (seed uchun; keyin `.env`dan olib tashlash mumkin) |

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

| Endpoint             | Ma'nosi                                                        |
| -------------------- | -------------------------------------------------------------- |
| `GET /api/v1/health` | Liveness — process tirikmi (konteyner restart siyosati uchun)   |
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

## 9. Baza rollari va RLS

PostgreSQL Row-Level Security (TASK-2.1) ikki xil rol talab qiladi:

| Rol              | Kim ishlatadi         | Huquq                                                   |
| ---------------- | --------------------- | ------------------------------------------------------- |
| `truckcontrol_migrator` | `migrate` servisi | `BYPASSRLS` — migratsiya barcha qatorlarni ko'radi      |
| `truckcontrol_app`      | `backend`         | `BYPASSRLS` **yo'q** — RLS siyosati unga ham tegishli   |

Application roli hech qachon `BYPASSRLS` bo'lmasligi kerak: aks holda RLS himoya qatlami
(ARCHITECTURE.md #3) shunchaki o'chib qoladi. Rollar TASK-2.1 migratsiyasi bilan birga
hujjatlashtiriladi va bu jadval o'shanda to'ldiriladi.
