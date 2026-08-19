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
   Kod AWS SDK (`@aws-sdk/client-s3`) orqali oddiy S3 protokolida gaplashadi,
   shuning uchun bir xil kod dev'dagi MinIO'ga ham, productiondagi istalgan
   S3-mos do'konga ham boradi — faqat `S3_*` o'zgaruvchilari o'zgaradi.
   Eski `MINIO_*` nomlari ham ishlaydi (docker-compose o'zgarmaydi).

   **Supabase Storage** S3'ni `/storage/v1/s3` yo'li ostida beradi va sessiya
   tokeni bilan autentifikatsiya qiladi: `S3_ACCESS_KEY_ID` = loyiha ref'i,
   `S3_SECRET_ACCESS_KEY` = anon key, `S3_SESSION_TOKEN` = service role key.
   Shuning uchun `S3_ENDPOINT` to'liq URL sifatida beriladi va
   `S3_FORCE_PATH_STYLE=true` bo'lishi shart.

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

| O'zgaruvchi            | Qiymat                                                        | Izoh                                                        |
| ---------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| `DATABASE_URL`         | `postgresql://…-pooler…`                                      | **pooled** URL                                              |
| `JWT_ACCESS_SECRET`    | tasodifiy ≥16 belgi                                           | `openssl rand -base64 32`                                   |
| `JWT_REFRESH_SECRET`   | tasodifiy ≥16 belgi                                           | boshqa qiymat                                               |
| `JWT_ACCESS_TTL`       | `15m`                                                         |                                                             |
| `JWT_REFRESH_TTL`      | `30d`                                                         |                                                             |
| `WEB_URL`              | `https://app.truckcontrol.uz`                                 | vergul bilan bir nechta bo'lishi mumkin                     |
| `WEB_PREVIEW_SUFFIX`   | `.vercel.app`                                                 | preview deploy'lariga CORS ruxsati                          |
| `CRON_SECRET`          | tasodifiy ≥16 belgi                                           | Vercel Cron shu bilan kiradi                                |
| `S3_ENDPOINT`          | to'liq URL, masalan `https://<ref>.supabase.co/storage/v1/s3` | yo'l prefiksi bilan ham bo'ladi                             |
| `S3_BUCKET`            | `truckcontrol`                                                | yo'q bo'lsa avtomatik yaratiladi                            |
| `S3_REGION`            | `us-east-1` (Supabase) / `auto` (R2)                          |                                                             |
| `S3_ACCESS_KEY_ID`     | access key                                                    | Supabase'da — loyiha ref'i                                  |
| `S3_SECRET_ACCESS_KEY` | secret key                                                    | Supabase'da — anon key                                      |
| `S3_SESSION_TOKEN`     | ixtiyoriy                                                     | Supabase'da — service role key                              |
| `S3_FORCE_PATH_STYLE`  | `true`                                                        | MinIO va yo'l prefiksli endpoint'lar uchun; AWS'da `false`  |
| `SMS_PROVIDER_URL`     | SMS shlyuzi endpoint'i                                        | hozircha **ixtiyoriy** — pastga qarang                      |
| `SMS_PROVIDER_TOKEN`   | shlyuz tokeni                                                 | `SMS_PROVIDER_URL` bilan birga                              |
| `NODE_ENV`             | `production`                                                  |                                                             |
| `API_PORT`             | `3000`                                                        | serverless'da ishlatilmaydi, lekin env sxemasi talab qiladi |

`CRON_SECRET` berilmasa `/api/v1/cron/*` endpoint'lari **yopiq** turadi —
noto'g'ri sozlangan deploy ularni ochib qo'ymaydi.

> **`SMS_PROVIDER_URL` haqida.** Hozirgi bosqichda kirish faqat login+parol
> orqali: ofis xodimi email+parol bilan, haydovchi esa logist bergan telefon
> raqami + parol bilan kiradi. SMS-kod oqimi (`POST /auth/driver/request-code`,
> `POST /auth/driver/verify`) kodda turibdi, lekin hech qayerda majburiy emas.
> Bu ikki o'zgaruvchi bo'sh qolsa `SmsService` xatolik bermaydi — kodni logga
> yozadi, xolos. **Shuning uchun SMS provayderi ulanmaguncha bu endpoint'lardan
> foydalanmang** (kod deploy loglarida ochiq qoladi). SMS va Google-kirish
> to'liq ishga tushgandan keyin qo'shiladi.

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

Migratsiya build'ning bir qismi (`apps/backend/deploy-db.sh`). Sabab: ko'p
muhitda bazaga faqat build konteyneridan tarmoq bor. `prisma migrate deploy`
faqat hali qo'llanmagan migratsiyalarni qo'llaydi — hech qachon reset, drop
yoki mavjud ma'lumotni qayta yozish qilmaydi, shuning uchun har deployda
takrorlanishi xavfsiz va odatda hech nima qilmaydi.

Migratsiya **to'g'ridan-to'g'ri** ulanishni talab qiladi (DDL pooler orqali
o'tmaydi). Supabase buni `POSTGRES_URL_NON_POOLING` sifatida beradi; ishlab
turgan ilova esa pooled `DATABASE_URL` dan foydalanadi. Skript
`POSTGRES_URL_NON_POOLING` yoki `DIRECT_DATABASE_URL` ni oladi; ikkalasi ham
bo'lmasa migratsiyani jimgina o'tkazib yuboradi.

Mahalliy ravishda ham ishga tushirish mumkin:

```bash
DATABASE_URL="<to'g'ridan-to'g'ri, pooler emas>" pnpm --filter backend db:deploy
```

### Platforma administratori

Yangi bazada hech kim yo'q, API esa foydalanuvchi yaratish uchun
autentifikatsiya talab qiladi. `src/scripts/bootstrap-superadmin.ts` shu
tugunni yechadi va u ham build'da ishlaydi:

- `SEED_SUPERADMIN_PASSWORD` (kamida 12 belgi) va `SEED_SUPERADMIN_EMAIL` yoki
  `SEED_SUPERADMIN_USERNAME` dan kamida bittasi qo'yilmasa — hech nima qilmaydi;
- allaqachon SUPERADMIN bo'lsa — tegmaydi.

**Parolni yoki login nomini almashtirish.** Boshqa yo'l yo'q: platforma hisobi
hech qaysi kompaniyaga tegishli emas, shuning uchun uni tenant API'si orqali
tahrirlab bo'lmaydi. Shu uchta o'zgaruvchini qo'yib bitta deploy qiling:

```
SEED_SUPERADMIN_USERNAME=<login>      # yoki SEED_SUPERADMIN_EMAIL
SEED_SUPERADMIN_PASSWORD=<yangi parol>
SEED_SUPERADMIN_RESET=true
```

`SEED_SUPERADMIN_RESET=true` bo'lmasa skript mavjud hisobga tegmaydi — ya'ni
tasodifiy deploy hech qachon parolni qayta yozib yubormaydi. Berilgan
identifikator ustiga yoziladi, berilmagani (masalan email) tegishsiz qoladi.

Ishlatib bo'lgach **darhol** `SEED_SUPERADMIN_RESET` va `SEED_SUPERADMIN_PASSWORD`
ni o'chiring: aks holda parol Vercel env'ida ochiq turadi va keyingi har bir
deploy uni qayta o'rnatadi.

### Kirish identifikatori

`POST /auth/login` `identifier` maydonini uch xil qabul qiladi: `@` bo'lsa —
email, faqat raqam/`+` bo'lsa — telefon, aks holda — login nomi (`users.username`,
kichik harflarda saqlanadi va shunday solishtiriladi).

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

### Tekshirish

Har bir deploydan keyin to'liq to'plamni ishga tushiring — funksional va
xavfsizlik regressiyalari real HTTPS orqali:

```bash
CRON_SECRET=<sir> scripts/prod-check.sh
# yoki boshqa muhit uchun:
API_URL=https://… WEB_URL=https://… scripts/prod-check.sh
```

U faqat o'qiydi; yagona yozadigan chaqiruvi — cron endpoint'i, u esa idempotent.
Bitta tekshiruv yiqilsa skript nolga teng bo'lmagan kod qaytaradi.

Tez tekshiruv:

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
