# Vercel'ga deploy qilish

TruckControl Vercel'da **ikkita alohida loyiha** sifatida turadi — ikkalasi ham shu
bitta repodan:

| Vercel loyihasi    | Root Directory | Nima bo'ladi                        |
| ------------------ | -------------- | ----------------------------------- |
| `truckcontrol-api` | `apps/backend` | NestJS bitta Vercel Function ichida |
| `truckcontrol-web` | `apps/web`     | Vite SPA statik build               |

Har bir papkadagi `vercel.json` build, rewrite va cron sozlamalarini o'zi olib
yuradi — Vercel UI'da faqat Root Directory, env o'zgaruvchilari va domenni
kiritish qoladi.

## 0. Oldindan kerak bo'ladigan tashqi xizmatlar

Vercel Function'lari qisqa umrli, shuning uchun holat saqlaydigan hamma narsa
tashqarida bo'lishi shart:

1. **PostgreSQL — pooled ulanish bilan.** Neon, Supabase yoki Vercel Postgres.
   Har bir function chaqiruvi yangi ulanish ochishi mumkin, shuning uchun
   **pooler** (PgBouncer) URL'ini oling, to'g'ridan-to'g'ri ulanishni emas.
   Neon'da bu `-pooler` qo'shilgan host, Supabase'da 6543-port.
2. **S3-mos fayl saqlash.** Cloudflare R2, AWS S3 yoki Supabase Storage.
   MinIO klienti oddiy S3 protokolida gaplashadi, shuning uchun kod
   o'zgarmaydi — faqat `MINIO_*` o'zgaruvchilari boshqa endpoint'ga qaraydi.

> Redis hozircha kodda ishlatilmaydi (`REDIS_URL` faqat env sxemasida turibdi),
> shuning uchun deploy uchun Redis shart emas.

## 1. Backend loyihasi (`truckcontrol-api`)

**Vercel UI sozlamalari**

- Root Directory: `apps/backend`
- **"Include files outside of the Root Directory"** — YOQILGAN bo'lishi shart.
  Bu pnpm workspace'ning ildizidagi `pnpm-lock.yaml` va `packages/shared` ga
  kirish imkonini beradi; o'chirilgan bo'lsa build `shared` topolmay yiqiladi.
- Build/Install buyruqlari — `vercel.json` dan olinadi, UI'da bo'sh qoldiring.

**Environment Variables**

| O'zgaruvchi           | Qiymat                                       | Izoh                                                        |
| --------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`        | `postgresql://…-pooler…`                     | **pooled** URL                                              |
| `JWT_ACCESS_SECRET`   | tasodifiy ≥16 belgi                          | `openssl rand -base64 32`                                   |
| `JWT_REFRESH_SECRET`  | tasodifiy ≥16 belgi                          | boshqa qiymat                                               |
| `JWT_ACCESS_TTL`      | `15m`                                        |                                                             |
| `JWT_REFRESH_TTL`     | `30d`                                        |                                                             |
| `WEB_URL`             | `https://app.truckcontrol.uz`                | vergul bilan bir nechta bo'lishi mumkin                     |
| `WEB_PREVIEW_SUFFIX`  | `.vercel.app`                                | preview deploy'lariga CORS ruxsati                          |
| `CRON_SECRET`         | tasodifiy ≥16 belgi                          | Vercel Cron shu bilan kiradi                                |
| `MINIO_ENDPOINT`      | masalan `<account>.r2.cloudflarestorage.com` | port/host, `https://` siz                                   |
| `MINIO_PORT`          | `443`                                        |                                                             |
| `MINIO_USE_SSL`       | `true`                                       |                                                             |
| `MINIO_ROOT_USER`     | access key                                   |                                                             |
| `MINIO_ROOT_PASSWORD` | secret key                                   |                                                             |
| `MINIO_BUCKET`        | `truckcontrol`                               | bucket oldindan yaratilgan bo'lsin                          |
| `MINIO_REGION`        | `auto` (R2) yoki `us-east-1` (AWS)           |                                                             |
| `SMS_PROVIDER_URL`    | SMS shlyuzi endpoint'i                       | **productionda majburiy** — pastga qarang                   |
| `SMS_PROVIDER_TOKEN`  | shlyuz tokeni                                | `SMS_PROVIDER_URL` bilan birga                              |
| `NODE_ENV`            | `production`                                 |                                                             |
| `API_PORT`            | `3000`                                       | serverless'da ishlatilmaydi, lekin env sxemasi talab qiladi |

`CRON_SECRET` berilmasa `/api/v1/cron/*` endpoint'lari **yopiq** turadi —
noto'g'ri sozlangan deploy ularni ochib qo'ymaydi.

> **`SMS_PROVIDER_URL` haqida.** U berilmasa `SmsService` xatolik bermaydi —
> haydovchining kirish kodini shunchaki logga yozadi. Dev'da bu qulay, lekin
> productionda ikki barobar yomon: haydovchilar kod ololmaydi, kod esa deploy
> loglarida ochiq turadi. Productionga chiqishdan oldin albatta to'ldiring.

**Install buyrug'i nega shunday** (`cd ../.. && pnpm install --frozen-lockfile --prod=false`)

Ikkita tuzoq bir qatorda hal qilinadi — ikkalasi ham real deployda yiqilishga
olib kelgan:

1. Vercel buyruqlarni **Root Directory** ichida ishga tushiradi. Workspace
   paketi ichidagi oddiy `pnpm install` faqat o'sha paketning bog'liqliklarini
   o'rnatadi, natijada `packages/shared` da `tsc` bo'lmaydi. Shuning uchun
   ildizga chiqib o'rnatiladi.
2. Vercel build vaqtida `NODE_ENV=production` qo'yadi, pnpm esa bunda
   **devDependencies'ni o'tkazib yuboradi** — `typescript`, `@nestjs/cli` va
   `prisma` aynan o'sha yerda. `--prod=false` ularni majburan o'rnatadi.
   Log'dagi belgisi: `devDependencies: skipped because NODE_ENV is set to production`.

**Build nima qiladi** (`apps/backend/vercel.json`):

```
pnpm --filter shared build
pnpm --filter backend exec prisma generate
pnpm --filter backend build
```

So'ng barcha so'rovlar `api/index.js` ga rewrite qilinadi. U faqat kichik JS
shim: kompilyatsiya qilingan `dist/serverless.js` ni chaqiradi. Sabab — Vercel
entrypoint'ni esbuild bilan o'tkazadi, esbuild esa NestJS DI uchun zarur bo'lgan
`design:paramtypes` metadata'sini chiqarmaydi. Shuning uchun butun ilova
oldindan `nest build` (tsc) bilan yig'iladi.

## 2. Migratsiyalar

Vercel build'i migratsiya ishlatmaydi (build vaqtida bazaga tegmagan ma'qul).
Birinchi deploydan oldin, keyin esa har sxema o'zgarganda mahalliy ravishda
ishga tushiring:

```bash
DATABASE_URL="<to'g'ridan-to'g'ri, pooler emas>" pnpm --filter backend db:deploy
```

`prisma/migrations/20260819000000_init` — joriy sxemaning bazaviy migratsiyasi.
Pooler orqali migratsiya qilmang: DDL uchun to'g'ridan-to'g'ri ulanish kerak.

## 3. Rejalashtirilgan vazifalar (cron)

Serverless'da `@nestjs/schedule` taymerlarini ushlab turadigan jarayon yo'q.
Shuning uchun ish HTTP orqali ochilgan va uni **Vercel Cron** chaqiradi —
`vercel.json` da e'lon qilingan:

```json
{ "path": "/api/v1/cron/archive-gps", "schedule": "0 3 * * *" }
```

Vercel bu so'rovga `Authorization: Bearer $CRON_SECRET` qo'yadi; `CronGuard`
uni tekshiradi. O'zini o'zi hostlagan (Docker) deployda `@Cron` dekoratori
avvalgidek ishlaydi.

Ish idempotent — arxivlash bitta SQL bayonotida bo'ladi, ikkinchi marta
ishga tushsa ko'chiradigan qator qolmaydi. Xatolik yuz bersa HTTP endpoint
**500** qaytaradi (va javobda `archived` soni bo'ladi), shuning uchun buzilgan
tungi ish Vercel cron tarixida muvaffaqiyatsiz bo'lib ko'rinadi. Doimiy
serverdagi taymer esa xatoni faqat logga yozadi — texnik xizmat ishi ishlab
turgan serverni yiqitmasligi kerak.

> Vercel Hobby tarifida cron kuniga 1 marta ishlaydi — bu vazifa uchun yetarli.

## 4. Frontend loyihasi (`truckcontrol-web`)

**Vercel UI sozlamalari**

- Root Directory: `apps/web`
- "Include files outside of the Root Directory" — YOQILGAN
- Framework: Vite (avtomatik aniqlanadi)

**Environment Variables**

| O'zgaruvchi    | Qiymat                               |
| -------------- | ------------------------------------ |
| `VITE_API_URL` | `https://api.truckcontrol.uz/api/v1` |

`VITE_*` build vaqtida bundle ichiga yoziladi, shuning uchun uni o'zgartirgach
qayta deploy qilish kerak.

`VITE_API_URL` production build'da **majburiy**: berilmasa `vite.config.ts`
build'ni to'xtatadi. Aks holda bundle ichiga dev fallback (`http://localhost:3000`)
yozilib qolar edi va deploy qilingan sayt har bir so'rovni tashrif buyuruvchining
o'z kompyuteriga yuborardi — jimgina va topish qiyin nosozlik.

`vercel.json` dagi rewrite barcha yo'llarni `index.html` ga qaytaradi — React
Router'ning `/trips/:id` kabi klient marshrutlari to'g'ridan-to'g'ri ochilganda
ham ishlashi uchun. `/assets/*` esa fayl tizimidan olinadi va bir yil
keshlanadi.

## 5. Deploy tartibi

```bash
# 1. Migratsiya (mahalliy, to'g'ridan-to'g'ri URL bilan)
DATABASE_URL="postgresql://…" pnpm --filter backend db:deploy

# 2. Vercel'da ikkala loyihani repoga ulang va env'larni kiriting.
#    Keyingi har push avtomatik deploy bo'ladi.
```

Tekshirish:

```bash
curl https://<api-domen>/api/v1/health
# {"success":true,"data":{"status":"ok"},"error":null,"meta":null}
```

### Joriy deploy (2026-08-19)

| Loyiha | Vercel nomi            | Production URL                          |
| ------ | ---------------------- | --------------------------------------- |
| API    | `truck-control-ai-api` | https://truck-control-ai-api.vercel.app |
| Web    | `truck-control-ai-web` | https://truck-control-ai-web.vercel.app |

> **Diqqat:** `DATABASE_URL` hozircha `REPLACE_ME` placeholder'i. Ilova
> ko'tariladi va `/health`, autentifikatsiya guard'lari, CORS hamda cron
> himoyasi ishlaydi, lekin bazaga tegadigan har bir endpoint (login, reyslar,
> moliya…) `500` qaytaradi. Real pooled Postgres URL'ini qo'yib, backend'ni
> qayta deploy qilgach hammasi ishlaydi. Fayl saqlash uchun `MINIO_*`
> o'zgaruvchilari ham hali qo'yilmagan.

## 6. Nimalarni bilib qo'yish kerak

Vercel'ning serverless modeli quyidagi cheklovlarni olib keladi:

- **Fayl yuklash 4.5 MB gacha.** Function so'rov tanasi shu bilan chegaralangan.
  Haydovchi ilovasi fotolari odatda undan kichik, lekin katta PDF yuklash
  ishlamaydi. Yechim — brauzerdan to'g'ridan-to'g'ri S3 ga presigned PUT bilan
  yuklash (hozircha qilinmagan).
- **Cold start.** Har uzoq tanaffusdan keyin birinchi so'rov Nest ilovasini
  ko'taradi (~1–2 s). Keyingi so'rovlar issiq instansiyani ishlatadi.
- **Baza ulanishlari.** Pooler majburiy; to'g'ridan-to'g'ri URL bilan ko'p
  ulanish limitiga tez urasiz.
- **Uzoq davom etadigan ish yo'q.** `maxDuration` 30 s. BullMQ worker'lari
  (hozircha ishlatilmaydi) kerak bo'lsa, ular alohida doimiy xostda turishi
  kerak — Vercel bunga mos emas.

Agar shu cheklovlar to'sqinlik qilsa, backend uchun doimiy konteyner (Railway,
Fly.io, Render yoki repodagi `docker-compose.yml`) mosroq bo'ladi — frontend
esa har qanday holatda Vercel'da qolishi mumkin.
