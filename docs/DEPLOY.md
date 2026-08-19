# Deploy — production (Docker Compose)

Bitta VPS uchun mo'ljallangan: backend, web (nginx), PostgreSQL, Redis, MinIO va
kunlik backup — hammasi `docker-compose.prod.yml` da. Faqat `web` konteyner
tashqariga port ochadi (80/443); baza, Redis va MinIO ichki tarmoqda qoladi.

Talab: Docker Engine 24+ va Compose v2 o'rnatilgan Linux server (2 vCPU / 4 GB
RAM 5–40 texnika uchun yetarli), domen A-yozuvi server IP'siga qaratilgan.

## 1. Birinchi ishga tushirish

```bash
git clone <repo> logixa && cd logixa
cp .env.production.example .env.production
# Kalitlarni generatsiya qiling va .env.production ni to'ldiring:
openssl rand -hex 32   # JWT_ACCESS_SECRET
openssl rand -hex 32   # JWT_REFRESH_SECRET
openssl rand -hex 24   # POSTGRES_PASSWORD / MINIO_ROOT_PASSWORD

docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

`DATABASE_URL` dagi parol `POSTGRES_PASSWORD` bilan bir xil bo'lishi shart —
compose ularni tekshirmaydi.

Backend konteyner har ishga tushganda quyidagilarni bajaradi
(`deploy/backend-entrypoint.sh`, hammasi idempotent):

1. bazani kutadi;
2. `prisma migrate deploy` — migratsiyalarni qo'llaydi;
3. `SUPERADMIN_EMAIL` berilgan bo'lsa va platformada superadmin bo'lmasa —
   uni yaratadi;
4. API'ni ishga tushiradi.

Tekshirish: `curl http://<domen>/healthz` → `ok`, `curl http://<domen>/api/v1/health`
→ `{"success":true,"data":{"status":"ok"},...}`.

## 2. HTTPS

Birinchi yuklashda `NGINX_TEMPLATE=app.conf.template` (faqat HTTP) — sertifikat
olish uchun shu holat kerak.

```bash
# 1) sertifikat olish (webroot orqali)
docker compose -f docker-compose.prod.yml --env-file .env.production \
  --profile certbot run --rm certbot

# 2) TLS shablonga o'tish
sed -i 's/^NGINX_TEMPLATE=.*/NGINX_TEMPLATE=app-tls.conf.template/' .env.production
sed -i 's#^WEB_URL=.*#WEB_URL=https://<domen>#' .env.production
docker compose -f docker-compose.prod.yml --env-file .env.production up -d web backend
```

Yangilash (90 kunda bir, cron'ga qo'ying):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  --profile certbot run --rm certbot && \
docker compose -f docker-compose.prod.yml --env-file .env.production exec web nginx -s reload
```

TLS blokida HSTS, TLS 1.2/1.3, gzip, xavfsizlik sarlavhalari va CSP yoqilgan
(`deploy/nginx/app-tls.conf.template`).

## 3. Yangi versiyani chiqarish

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Web bundle `VITE_API_URL` bilan build vaqtida yig'iladi — shuning uchun web
o'zgarganda `--build` majburiy. Migratsiyalar backend start'ida avtomatik
qo'llanadi; eski konteyner yangisi tayyor bo'lgach to'xtaydi.

## 4. Backup va tiklash

`backup` servisi har kuni `BACKUP_HOUR_UTC` da (default 22:00 UTC = 03:00
Toshkent) `pg_dump` qiladi, `BACKUP_RETENTION_DAYS` kun saqlaydi va nusxalarni
`backups` volume'iga yozadi.

```bash
# ro'yxat
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec backup ls -lh /backups

# nusxani serverga chiqarish
docker cp "$(docker compose -f docker-compose.prod.yml --env-file .env.production ps -q backup)":/backups ./backups

# tiklash (diqqat: mavjud ma'lumot o'chadi)
docker compose -f docker-compose.prod.yml --env-file .env.production stop backend
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < backups/<fayl>.dump
docker compose -f docker-compose.prod.yml --env-file .env.production start backend
```

Volume'lar (`postgres-data`, `minio-data`, `backups`) serverdan tashqariga ham
ko'chirilishi kerak — kamida haftada bir marta boshqa joyga (S3, ikkinchi
server) nusxalang. Tiklashni **sinab ko'ring**: sinalmagan backup — backup emas.

## 5. Fayllar (MinIO)

Hozircha MinIO faqat ichki tarmoqda: haydovchi foto'ni backend orqali yuklaydi,
brauzer MinIO'ga to'g'ridan-to'g'ri murojaat qilmaydi. Konsol faqat loopback'da
(`127.0.0.1:9001`) — SSH tunnel orqali oching:

```bash
ssh -L 9001:127.0.0.1:9001 user@server   # keyin http://localhost:9001
```

Hujjatlar UI'si qo'shilganda (7-bosqich) brauzerga imzolangan URL beriladi va
MinIO tashqaridan ochilishi kerak bo'ladi. Buning uchun tayyor shablon bor —
`deploy/nginx/s3.conf.template` (alohida subdomen); ichida qadamlar yozilgan.

## 6. Kuzatuv

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f backend
docker compose -f docker-compose.prod.yml --env-file .env.production ps      # healthcheck holati
```

Backend `/api/v1/health`, web `/healthz` bilan tekshiriladi; ikkalasida ham
Docker healthcheck yoqilgan. Tashqi monitoring uchun shu ikki manzilni ishlating.

## 7. Xavfsizlik eslatmalari

- `.env.production` hech qachon commit qilinmaydi (`.gitignore` da).
- `SUPERADMIN_PASSWORD` birinchi kirishdan keyin almashtiriladi; parol kamida
  12 belgi (kod tekshiradi).
- 80/443 dan boshqa portlar tashqariga ochilmagan — serverda ham faqat shu
  ikkitasini firewall'da oching.
- `WEB_URL` CORS uchun ishlatiladi (`main.ts`) — u aniq domen bo'lishi kerak,
  `*` emas.
- Yangilanishlardan keyin `docker image prune -f` bilan eski image'larni
  tozalang.

## 8. Vercel (faqat frontend)

Mavjud loyiha: **`truck-control-ai-web`** → https://truckai.vercel.app
API esa alohida loyihada: `truck-control-ai-api` → `VITE_API_URL` shunga qaragan.

Vercel statik saytlarni xosting qiladi — PostgreSQL, Redis va MinIO baribir
yuqoridagi Compose stack'da qoladi. Web ikki manzil beradi:

| Manzil  | Nima            | Talab                                 |
| ------- | --------------- | ------------------------------------- |
| `/`     | Haqiqiy ilova   | `VITE_API_URL` ishlaydigan backend'ga |
| `/demo` | Namoyish (mock) | Yo'q — brauzerda mustaqil ishlaydi    |

### Sozlamalar

Loyihaning **Root Directory** i `apps/web`, shuning uchun Vercel konfiguratsiyasi
ham o'sha papkada: [`apps/web/vercel.json`](../apps/web/vercel.json). Dashboard'da
qo'lda hech narsa kiritish shart emas:

| Sozlama          | Qiymat                           | Izoh                                    |
| ---------------- | -------------------------------- | --------------------------------------- |
| Framework        | Other (`null`)                   | Vite'ni o'zimiz chaqiramiz              |
| Root Directory   | `apps/web`                       | Loyiha sozlamasi (dashboard)            |
| Install Command  | `pnpm install --frozen-lockfile` | repo ildizida ishlaydi — butun monorepo |
| Build Command    | `pnpm -w run build:vercel`       | `-w` — skript ildizdagi package.json da |
| Output Directory | `dist`                           | Root Directory ga nisbatan              |

`pnpm build:vercel` ketma-ketligi: `shared` → `web` → `web build:demo` →
`scripts/stage-demo.mjs` (namoyishni `apps/web/dist/demo` ga ko'chiradi).

### Deploy

```bash
vercel link --yes --project truck-control-ai-web --token "$VERCEL_TOKEN"
vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```

`VITE_API_URL` build vaqtida bundle ichiga kiradi — o'zgartirgandan keyin qayta
deploy qilish shart:

```bash
vercel env rm VITE_API_URL production --token "$VERCEL_TOKEN"
vercel env add VITE_API_URL production --token "$VERCEL_TOKEN"
```

Backend tomonda `WEB_URL` Vercel domeniga teng bo'lishi kerak (CORS shuni
tekshiradi) va backend HTTPS ostida turishi shart — aks holda brauzer
`http://` so'rovni mixed content sifatida bloklaydi:

```bash
WEB_URL=https://truckai.vercel.app
docker compose -f docker-compose.prod.yml --env-file .env.production up -d backend
```

`VITE_API_URL` berilmasa build baribir o'tadi, lekin `/` dagi kirish formasi
API'ni topa olmaydi — shu holatda forma ostida `/demo` ga havola ko'rsatiladi.

### Git bilan avtomatik deploy

Loyiha GitHub repo'ga bog'langan: har push preview deployment beradi, production
esa faqat Vercel → Settings → Git → **Production Branch** dagi branch'dan
yangilanadi. Ish branch'ini production qilish uchun yo o'sha sozlamani
o'zgartiring, yo yuqoridagi `vercel deploy --prod` ni ishlating.

CI'dan chiqarish uchun `VERCEL_TOKEN` kerak (Vercel → Account Settings →
Tokens); token faqat CI secret'ida saqlanadi, repoda emas.
