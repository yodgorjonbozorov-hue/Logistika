# FIX PROGRESS

Boshlangan: 2026-08-17

## Holat

- [x] PHASE 0 — Baseline
- [x] PHASE 1 — Blockers (8 ta task)
- [x] PHASE 2 — Security (9 ta task)
- [ ] PHASE 3 — Core business (12 ta task)
- [ ] PHASE 4 — Performance (6 ta task)
- [ ] PHASE 5 — UX (5 ta task)

## BEFORE (baseline, PHASE 0 / TASK-0.1)

Muhit: Node v22.22.2, pnpm 9.15.0, Docker 29.3.1 (daemon qo'lda ishga tushirildi),
`docker compose up -d` → postgres/redis/minio healthy.

| Gate buyrug'i                        | Natija                                                     |
| ------------------------------------ | ---------------------------------------------------------- |
| `pnpm --filter shared build`          | OK (dist yaratildi)                                        |
| `pnpm --filter backend prisma generate` | OK                                                       |
| `pnpm lint`                           | 0 xato                                                     |
| `pnpm --filter backend exec tsc --noEmit` | 0 xato                                                 |
| `pnpm --filter web exec tsc -b`       | 0 xato                                                     |
| `pnpm test`                           | backend **15/15 suite, 82 test o'tdi**; web 2 fayl, 11 test o'tdi; shared `tsc --noEmit` OK |
| `pnpm --filter backend test:e2e`      | **"No tests found, exiting with code 0"** — 0 e2e test      |
| `pnpm build`                          | OK (backend + web + shared)                                |

### Audit bashorati bilan farq (muhim)

Audit hisoboti `pnpm test` → «14/15 backend suite `Cannot find module 'shared'` bilan yiqiladi»
deb bashorat qilgan edi. **Bu holat reproduce bo'lmadi**: `apps/backend/package.json` jest
konfiguratsiyasida `moduleNameMapper` bor —
`"^shared$": "<rootDir>/../../../packages/shared/src/index.ts"` — shuning uchun unit testlar
`shared` dist'iga umuman bog'liq emas va toza checkout'da ham o'tadi.

Ammo TASK-1.3 muammosining ildizi baribir bor va yopilishi kerak:

- `packages/shared` `test` skripti `tsc --noEmit` — ya'ni `pnpm -r test` dist yaratmaydi;
- `main`/`types` esa `dist/*`ga ishora qiladi → `dist`ga tayanadigan har qanday iste'molchi
  (backend `build`, e2e testlar, `node dist/main.js` runtime) toza checkout'da sinadi;
- e2e infratuzilmasi va `passWithNoTests: false` masalasi audit yozganidek — o'zgarishsiz.

TASK-1.3 shu ikki nuqtani (dist kafolati + real e2e) yopadi.

### Baseline raqamlari (solishtirish nuqtasi)

- Unit testlar: backend 82, web 11, jami **93**
- E2E testlar: **0**
- Lint xatolari: **0**
- Typecheck xatolari: **0**
- Coverage threshold: **yo'q**
- Prisma migratsiyalari: **0** (faqat `schema.prisma`), seed: **yo'q**

## Bajarilgan tasklar

(har task tugagach shu yerga yoz: TASK-ID · qisqa izoh · o'zgargan fayllar · commit hash)

- **TASK-0.1** · Baseline qayd etildi (yuqoridagi BEFORE bo'limi) · `FIX-PROGRESS.md`
- **TASK-1.1 (C-2)** · Prisma init migratsiyasi + idempotent seed (SUPERADMIN majburiy paroldan,
  dev'da demo tenant). `.env` monorepo ildizida qoldi: backend `envFilePath` bilan, Prisma CLI
  `dotenv-cli` bilan o'qiydi (avval Prisma CLI `DATABASE_URL` topa olmasdi). ·
  `apps/backend/prisma/migrations/20260817113442_init/`, `apps/backend/prisma/seed.ts`,
  `apps/backend/package.json`, `apps/backend/src/app.module.ts`, `.env.example`, `README.md`,
  `CLAUDE.md` · tasdiqlandi: toza bazada `migrate deploy && db seed` ishlaydi, seed 2-marta
  ishga tushirilganda dublikat yaratmaydi, `SEED_SUPERADMIN_PASSWORD` yo'q bo'lsa xato bilan to'xtaydi.
- **TASK-1.2 (C-3, M-10, M-11)** · Mobil offline navbat ma'lumot yo'qotmaydi: `rejected` endi
  `synced = 1` qilinmaydi, balki `retry_count++` + `last_error` + exponential backoff (30s → 2h),
  5 urinishdan keyin `needs_attention` va profil ekranida qo'lda «Qayta yuborish». SQLite v2
  migratsiyasi (`onUpgrade`, avval umuman yo'q edi) va `purgeSynced()` (7 kundan eski synced
  yozuvlar) qo'shildi. · `lib/core/db/app_database.dart`, `lib/core/sync/offline_queue.dart`,
  `lib/features/profile/profile_tab.dart`, `lib/core/i18n/app_strings.dart` (3 til),
  `test/offline_queue_test.dart` (+4 test) · `flutter test` 10/10, `flutter analyze` toza.
- **TASK-1.3 (C-4)** · Test infratuzilmasi: `packages/shared` `test` skripti endi emit qiladi
  (`dist` kafolati), `jest-e2e.json` → `passWithNoTests: false`, real bazali e2e harness
  (`test/setup-e2e.ts` — alohida `DATABASE_URL_TEST` bazasi, avtomatik `CREATE DATABASE` +
  `migrate deploy`, har testdan oldin TRUNCATE; `test/helpers.ts` — `createTenant()` fabrikasi),
  majburiy `tenant-isolation.e2e-spec.ts` (17 test: trips, drivers, vehicles, clients, expenses,
  incomes, events, tracking, files, company), coverage threshold + `test:cov`, CI workflow
  (postgres + redis service, backend/web/mobil job'lari) · `packages/shared/package.json`,
  `apps/backend/package.json`, `apps/backend/test/*`, `.github/workflows/ci.yml` ·
  **e2e 0 → 17 test**, hammasi real PostgreSQL'da.
- **TASK-1.4 (C-7)** · Haydovchi tugmasi endi reysni haqiqatan harakatga keltiradi: `ingestBatch`
  START/LOADED → `IN_PROGRESS` (`startedAt`, `startOdometer` hodisadan), FINISH → `COMPLETED`
  (`finishedAt`, `endOdometer`, `actualDistanceKm`). Status o'zgarishi atomik
  (`updateMany({ where: { id, status: kutilgan } })` + `count === 0` → rejected), hodisa yozuvi +
  status + audit bitta `$transaction` ichida. `TRANSITIONS` guard'i
  `common/trip-transitions.ts`ga chiqarildi (logist va haydovchi yo'llari bitta manbadan).
  `GET /trips/:id` endi DRIVER uchun ham ochiq, lekin faqat o'z reysi
  (`trip.driverId === driver.id`, aks holda 404). · `src/common/trip-transitions.ts`,
  `src/modules/events/events.service.ts`, `src/modules/trips/trips.service.ts`,
  `src/modules/trips/trips.controller.ts`, `src/test-utils/tenant-db.mock.ts`,
  `events.service.spec.ts` (+6), `test/driver-flow.e2e-spec.ts` (+5 e2e) ·
  unit 82 → 88, e2e 17 → 22. Jonli xaritada START → `MOVING` e2e bilan tasdiqlangan.
- **TASK-1.5 (C-5, H-10)** · Rate limiting + helmet + NODE_ENV: `ThrottlingModule` (Redis
  storage, 4 ta nomlangan tracker — IP / identifier / telefon / user), endpoint limitlari
  (`/auth/login` 5-daq-IP + 10-soat-identifier, `driver/request-code` 3-soat-telefon +
  10-soat-IP, `driver/verify` 10/soat, `/auth/refresh` 30/daq, `public/track` 60/daq,
  `/files/upload` 30/daq-user, `/tracking/positions` va `/events/batch` 60/daq-user).
  SMS attempts-reset teshigi yopildi: kunlik 10 kod chegarasi DB darajasida sanaladi va
  ishlatilgan kodlar **o'chirilmaydi** (aks holda hisob nolga tushardi). `devCode` butunlay
  olib tashlandi (H-10 account takeover). `helmet()` + `express.json({ limit: '1mb' })`.
  `NODE_ENV` majburiy — default olib tashlandi. Yangi kodlar: `RATE_LIMIT_EXCEEDED` (429),
  `SMS_DAILY_LIMIT` (429) — 3 tilda. Bootstrap `src/bootstrap.ts`ga chiqarildi, e2e endi
  aynan production pipeline'ini sinaydi. · `src/common/throttling/*`, `src/bootstrap.ts`,
  `src/main.ts`, `src/config/env.validation.ts` (+spec), `driver-auth.service.ts` (+spec),
  `auth/public-link/files/tracking/events` kontrollerlari, `packages/shared/src/index.ts`,
  i18n × 3 · unit 88 → 95, e2e 22 → 26.
- **TASK-1.6 (C-6)** · iOS ilovasi endi crash bo'lmaydi: `Info.plist`ga 4 ta ruxsat matni
  (o'zbekcha, aniq sabab bilan) + `UIBackgroundModes: [location]`. `gps_service.dart`
  platformaga qarab `AndroidSettings` / `AppleSettings`
  (`allowBackgroundLocationUpdates`, `showBackgroundLocationIndicator`,
  `pauseLocationUpdatesAutomatically: false`). Android'da cleartext faqat **debug** build'da
  (`android/app/src/debug/`), release'da `AppConfig.assertSecureInRelease()` HTTPS talab qiladi. ·
  `ios/Runner/Info.plist`, `lib/core/gps/gps_service.dart`, `lib/core/config.dart`,
  `lib/main.dart`, `android/app/src/debug/*`, `test/gps_settings_test.dart` (+4),
  `docs/ROADMAP.md`, `mobile/.../README.md` · `flutter test` 14/14, `flutter analyze` toza.
  **Halol qayd:** iOS real qurilmada/simulyatorda tekshirilmadi — muhitda macOS/Xcode yo'q,
  ROADMAP va README'ga shundoq yozildi.
- **TASK-1.7 (H-12)** · Env sxemasi to'liq: MinIO (endpoint/port/bucket/user/password —
  majburiy), `WEB_URL` majburiy (CORS `getOrThrow` bilan o'qiydi), SMS/Telegram/Anthropic/seed
  kalitlari opsional. `?? ''` va `?? 'localhost'` fallback'lari `getOrThrow` bilan almashtirildi —
  ya'ni sozlanmagan app **ko'tarilmaydi** (avval ko'tarilardi va har fayl yuklashda yiqilardi).
  `MINIO_PUBLIC_ENDPOINT/PORT/USE_SSL` qo'shildi: presigned URL brauzer ochadigan manzil bilan
  imzolanadi (Docker ichidagi `minio` hostname tashqarida ochilmaydi). Production'da qat'iyroq
  tekshiruv: JWT sirlari ≥ 32 belgi va bir-biridan farqli, `MINIO_USE_SSL=true`,
  `WEB_URL` `https://`. · `src/config/env.validation.ts` (+spec: 13 test),
  `src/modules/files/files.service.ts` (+spec), `.env.example` · unit 95 → 104.
- **TASK-1.8 (H-19, qismi)** · Deployment artefaktlari: `apps/backend/Dockerfile`
  (multi-stage, non-root `app` user, `vips` + `dumb-init`, prod-only bog'liqliklar),
  `apps/web/Dockerfile` (Vite build → nginx statik, `VITE_API_URL` build-arg),
  `docker-compose.prod.yml` (healthcheck'lar, `restart: unless-stopped`, migratsiya —
  **alohida bir martalik servis**, backend `service_completed_successfully` kutadi),
  `nginx/nginx.conf` (TLS, HSTS, gzip, `/api` proxy + `X-Forwarded-For` — rate limiter
  shu header'ni o'qiydi), `nginx/web.conf` (SPA fallback), `.dockerignore`,
  `docs/DEPLOYMENT.md` (env jadvali, TLS, seed, rolling update, rollback, DB rollari).
  `@nestjs/terminus` bilan real health: `/health` (liveness) va `/health/ready`
  (Postgres `SELECT 1` + Redis `PING` + MinIO `bucketExists`, 503 va qaysi bog'liqlik
  yiqilgani javobda). · unit 104, e2e 29 (+3 health).
  **Konteyner real ishga tushirib tekshirildi**: `/health/ready` uchtala bog'liqlikni `up`
  deb qaytardi, `/auth/login` token berdi, production hardening `MINIO_USE_SSL=false` bilan
  ishga tushishdan bosh tortdi (kutilgan xatti-harakat).

### PHASE 2 — SECURITY

- **TASK-2.1 (C-1) — PostgreSQL RLS** · Hujjatdagi «uchinchi himoya qatlami» endi kodda ham bor.
  Migratsiya: 15 ta tenant jadvaliga `ENABLE` + **`FORCE ROW LEVEL SECURITY`** va
  `tenant_isolation` siyosati (`USING` + `WITH CHECK`). Tenant konteksti har so'rovda
  `set_config('app.company_id', <id>, true)` bilan e'lon qilinadi (`rls.extension.ts`),
  atomik ish uchun `PrismaService.forCompanyTx()` — kontekst bitta tranzaksiyada bir marta.
  `forCompany()` API'si **o'zgarmadi** (barcha mavjud servislar tegilmadi).
  **Ikki ulanish**: `DATABASE_URL` (migratsiya/seed/pre-auth) va `DATABASE_URL_APP`
  (tenant trafigi, `BYPASSRLS`siz rol) — `scripts/create-db-roles.sql` bilan yaratiladi.
  Backend start'da rolni tekshiradi: production'da tenant ulanishi RLS'ni chetlab o'ta olsa
  **ko'tarilmaydi**, dev'da ogohlantiradi. ·
  `prisma/migrations/20260817130000_row_level_security/`, `src/prisma/rls.extension.ts` (+spec),
  `src/prisma/prisma.service.ts`, `src/config/env.validation.ts`, `src/modules/events/events.service.ts`,
  `src/test-utils/tenant-db.mock.ts`, `scripts/create-db-roles.sql`, `test/rls.e2e-spec.ts` (+7 e2e),
  `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `.env.example` · unit 104 → 107, e2e 29 → 36.
  **Acceptance bajarildi**: cheklangan rol bilan, Prisma extension'ini butunlay chetlab o'tib
  yozilgan xom SQL boshqa tenant qatorini **0 qator** qaytaradi; `INSERT` boshqa `company_id`
  bilan rad etiladi; `UPDATE`/`DELETE` 0 qatorga tegadi; kontekst pool'dagi keyingi so'rovga
  sizib o'tmaydi.
  **Diqqat (dev muhiti)**: dev'da baza egasi (superuser) sifatida ulanilgani uchun RLS amalda
  ishlamaydi — bu PostgreSQL qoidasi, `FORCE` ham superuser'ni to'xtatmaydi. Shuning uchun
  `DATABASE_URL_APP` production'da majburiy va start'da tekshiriladi.
- **TASK-2.2 (C-1 davomi)** · Money servislarida tenant ref tekshiruvi. `assertTenantRefs()`
  umumiy helper'i (`common/tenant-refs.ts`) — `tripId/vehicleId/trailerId/driverId/clientId`
  parallel tekshiriladi, topilmasa `NOT_FOUND` (tenant-scoped qidiruv tufayli begona id
  yo'q id'dan farq qilmaydi). `createExpense`, `updateExpense`, `createIncome`, `updateIncome`
  hammasida chaqiriladi; `trips.service` ham shu helper'ga o'tkazildi.
  `as Prisma.*UncheckedCreateInput` cast'lari olib tashlandi — `TenantActor` tipi
  (`shared`) + `requireTenantActor()` bilan `companyId` to'g'ri tiplandi (avval cast
  `companyId: null` holatini yashirardi). ·
  `src/common/tenant-refs.ts` (+spec 6 test), `src/common/tenant-actor.ts`,
  `src/modules/expenses/expenses.service.ts` (+spec 11 test),
  `src/modules/trips/trips.service.ts`, `packages/shared/src/index.ts` ·
  unit 107 → 124. **N-3 yopildi**: `tenant-isolation.e2e-spec.ts`dagi ikkita `it.failing`
  oddiy `it()`ga qaytarildi va o'tmoqda — B tenant A'ning `tripId`/`clientId` bilan
  xarajat/kirim yarata olmaydi. `expenses.service.ts` qamrovi 51% → 74% (branch 22% → 67%).
- **TASK-2.3 (H-5, M-6 qismi)** · `GET /events` endi `ListEventsDto` talab qiladi:
  `tripId` **majburiy** `@IsUUID()` (avval DTO'siz `@Query('tripId')` edi — berilmasa
  `where: { tripId: undefined }` bo'lib butun kompaniyaning hamma hodisasi qaytardi,
  pagination'siz, DRIVER roli uchun ham). Endi pagination + `from`/`to` filtri va
  **ownership tekshiruvi**: DRIVER faqat o'z reysining hodisalarini ko'radi, aks holda 404.
  `tracking.controller.ts`dagi qo'lda sana tekshiruvi `RequiredDateRangeDto`ga o'tkazildi
  (`@IsDate()` bilan — `Invalid Date` endi Prisma'ga bormaydi va xom 500 bermaydi).
  Umumiy `DateRangeDto`/`RequiredDateRangeDto` `common/dto/`da. Butun kod bazasi tekshirildi:
  DTO'siz `@Query('...')` boshqa qolmadi. Web timeline `limit: 100` bilan so'raydi
  (default 20 uzun reysni qirqib qo'yardi). ·
  `src/common/dto/date-range.dto.ts`, `src/modules/events/dto/event.dto.ts`,
  `events.controller.ts`, `events.service.ts` (+6 unit test),
  `tracking.controller.ts`, `apps/web/.../TripDetailPage.tsx`,
  `test/query-validation.e2e-spec.ts` (+8 e2e) · unit 124 → 130, e2e 36 → 44.
- **TASK-2.4 (H-9)** · Refresh token: (A) rotatsiya endi atomik — `updateMany({ where: { id,
  revokedAt: null } })` + `count === 0` → 401 (avval `findUnique` → tekshir → `update` edi,
  2 parallel refresh ikkalasi ham yangi juftlik olardi). (B) **Reuse detection**: bekor qilingan
  token qayta kelsa butun **oila** (`familyId`) revoke qilinadi + `REFRESH_REUSE_DETECTED`
  audit yozuvi + `Logger.warn`; yangi kod `AUTH_REFRESH_REUSED` (401, 3 tilda). Migratsiya:
  `replaced_by_id`, `family_id` (+`expires_at` va `family_id` indekslari — L-3). Har login
  o'z oilasini boshlaydi, shuning uchun bitta qurilmadan chiqish boshqalarini yiqitmaydi.
  Muddati o'tgan tokenlarni tozalaydigan kunlik cron qo'shildi (TASK-4.4 uni distributed
  lock'ga o'tkazadi). (C) **Client single-flight**: web `client.ts` va mobil `api_client.dart`
  parallel 401'larda bitta refresh promise'ini kutadi — avval har biri rotatsiya qilib,
  birinchisidan boshqasi «sababsiz logout» olardi. ·
  `prisma/migrations/20260817140000_refresh_token_family/`, `schema.prisma`,
  `auth.service.ts` (+spec 5 test), `apps/web/.../client.ts` (+2 test),
  `mobile/.../api_client.dart` (+`test/api_client_test.dart`, 2 test),
  `test/refresh-rotation.e2e-spec.ts` (+6 e2e), shared + i18n × 3 ·
  unit 130 → 134, web 11 → 13, mobil 14 → 16, e2e 44 → 50.
- **TASK-2.5 (H-11, M-1)** · Parol boshqaruvi: `POST /auth/change-password` (eski parolni
  argon2 bilan tekshiradi, muvaffaqiyatda **barcha** sessiyalarni revoke qiladi + audit),
  `POST /auth/forgot-password` + `POST /auth/reset-password` (token `randomBytes(32)`,
  bazada **faqat hash**, TTL 30 daqiqa, bir martalik — `usedAt` compare-and-set bilan;
  enumeratsiyasiz: noma'lum identifikator uchun ham bir xil javob; rate limit 3/soat).
  Parol siyosati: `IsStrongPassword()` dekoratori (≥10 belgi, harf + raqam, keng tarqalgan
  parollar ro'yxati, ism/emailga o'xshashlik tekshiruvi) — `create-user.dto.ts`ga ham
  qo'llandi. Account lockout: 10 muvaffaqiyatsiz urinishdan keyin 15 daqiqa
  (`failedLoginAttempts`, `lockedUntil`; muvaffaqiyatli login nolga qaytaradi; reset lockout'ni
  bekor qiladi). **M-1 tuzatildi**: `isActive` tekshiruvi endi `argon2.verify`dan **oldin** —
  avval deaktivatsiya qilingan hisob uchun ham parolning to'g'riligi tasdiqlanardi.
  Yangi kodlar `AUTH_ACCOUNT_LOCKED` (403), `AUTH_RESET_TOKEN_INVALID` (400) — 3 tilda.
  Web: `/forgot-password`, `/reset-password`, `/change-password` sahifalari + login'da havola,
  i18n 3 tilda. · migratsiya `20260817150000_password_management`, `password.service.ts`,
  `common/dto/password.ts` (+spec 7 test), `auth.service.ts` (+spec 5 test), web 3 sahifa,
  `test/password-flows.e2e-spec.ts` (+14 e2e) · unit 134 → 146, e2e 50 → 64.
  **Bloklandi (qisman)**: email provayder yo'q — reset havolasi telefon bo'lsa SMS bilan
  yuboriladi, email bo'lsa `[DEV EMAIL]` log'iga yoziladi (interfeys tayyor, integratsiya
  keyingi bosqichda).
- **TASK-2.6 (H-15)** · Token saqlash va transport (**buzuvchi o'zgarish**, uch tomon birga
  yangilandi). Backend: refresh token brauzerlar uchun `httpOnly; SameSite=Strict; Path=/api/v1/auth`
  cookie'ga o'tkazildi va **javob tanasidan butunlay olib tashlandi**; `refresh`/`logout` avval
  cookie'ni, keyin body'ni o'qiydi (mobil uchun). Klient turi `X-Client: mobile` header'i bilan
  ajratiladi. `SameSite=Strict` + mavjud bitta-origin CORS → CSRF uchun alohida token shart emas.
  Web: access token endi **faqat xotirada** (localStorage'da hech narsa qolmadi — XSS bo'lsa
  30 kunlik refresh token o'g'irlanardi); `ProtectedRoute` token borligini emas, `/auth/me`
  natijasini kutadi (loading holati bilan, flash yo'q). Mobil: `flutter_secure_storage`
  (Keychain / Android KeyStore) — eski `SharedPreferences` yozuvlari bir martalik migratsiya
  bilan ko'chiriladi va o'chiriladi, ya'ni yangilanishda haydovchi tizimdan chiqib ketmaydi. ·
  `auth.controller.ts`, `refresh-cookie.ts`, `bootstrap.ts` (cookie-parser), `refresh.dto.ts`,
  web `client.ts` / `AuthContext.tsx` / `ProtectedRoute.tsx` (+3 test),
  mobil `token_store.dart` (+`test/token_store_test.dart`, 6 test), `api_client.dart`,
  `test/token-transport.e2e-spec.ts` (+7 e2e) · web 13 → 16, mobil 16 → 22, e2e 64 → 71.
- **TASK-2.7 (H-13, M-17)** · Fayl yuklash xavfsizligi: **magic-byte** tekshiruvi
  (`common/file-signature.ts` — JPEG/PNG/WebP/PDF; client MIME'ga umuman ishonilmaydi,
  `.exe`ni `image/jpeg` deb yuborish rad etiladi). PDF uchun `%PDF-` + `%%EOF` tekshiruvi.
  `sharp(..., { limitInputPixels: 50M, failOn: 'error' })` + try/catch → buzuq rasm **415**
  (avval xom 500). Presigned URL'da `Content-Disposition: attachment` + qat'iy `Content-Type`
  va tozalangan fayl nomi. Tenant kvotasi (5 GB, `QUOTA_EXCEEDED` 413). AV uchun `FileScanner`
  interfeysi + `NoopFileScanner` (dev'da bir marta ogohlantirish yozadi — «AV bor» degan
  yolg'on taassurot qolmasligi uchun); `FILE_INFECTED` kodi tayyor. Multer chegarasi
  15 MB → **8 MB** (memory storage RAM byudjeti). M-17: kunlik orphan-fayl tozalash job'i
  (24 soatdan oshgan, hech qanday hodisaga bog'lanmagan fayllar MinIO'dan va bazadan). ·
  `common/file-signature.ts` (+spec 8 test), `files/file-scanner.ts`, `files.service.ts`
  (+spec 7 test), `files.controller.ts`, `files.module.ts`, shared + i18n × 3 ·
  unit 146 → 160.
- **TASK-2.8 (H-19 davomi)** · Zaxira, monitoring, error tracking. `scripts/backup.sh`
  (kunlik `pg_dump`, gzip, sana bilan, MinIO'ga yuklash, 30 kunlik retention, **bo'sh dump
  xato sifatida qaytadi**), `scripts/restore.sh` (tasdiqlash so'raydi, `--single-transaction`),
  `scripts/backup-loop.sh` + prod compose'da `backup` sidecar. Sentry (`@sentry/node`) —
  faqat `SENTRY_DSN` bo'lsa yoqiladi, `AppExceptionFilter`dagi **kutilmagan** xatolarni
  yuboradi (AppException emas — u boshqariladigan natija), PII (parol, token, telefon, INN)
  `beforeSend`da tozalanadi. Structured JSON logging (`nestjs-pino`): `requestId`
  (javob header'ida ham), `userId`, `companyId`, `duration`; maxfiy maydonlar redact
  qilinadi; health-check loglari o'chirilgan. `docs/DISASTER-RECOVERY.md` (RPO/RTO,
  tiklash qadamlari, **oylik mashq protokoli**, halol «nima ishlamayapti» ro'yxati) va
  `docs/RUNBOOK.md` (8 ta alert × nima tekshirish × nima qilish). ·
  `common/observability/*` (+spec 4 test), `app-exception.filter.ts`, `main.ts`,
  `env.validation.ts`, `scripts/*.sh`, `docker-compose.prod.yml`, `.env.example` ·
  unit 160 → 164.
- **TASK-2.9 (H-18)** · Audit log to'liq: `drivers`, `clients`, `vehicles` servislarida audit
  **umuman yo'q edi** — `Driver.salaryValue` va `Client.balance` aynan o'sha jadvallarda.
  Endi har mutatsiya `before` + `after` bilan yoziladi. `updateIncome` va `updateExpense`/
  `removeExpense`/`approveExpense` ham yozadi. Nozik operatsiyalar uchun
  `AuditService.logInTx(tx, entry)` — audit yozuvi **o'zgarish bilan bitta tranzaksiyada**
  (avval fire-and-forget edi: rollback bo'lsa audit qolardi yoki teskarisi).
  `toAuditJson()` BigInt/Decimal'ni **string**ga aylantiradi (JSON'da BigInt yo'q, float
  tiyinni yo'qotadi) va `passwordHash`/token'larni `passwordChanged: true` naqshiga
  almashtiradi. `audit_logs` **immutable**: UPDATE/DELETE'ni DB trigger'i rad etadi —
  ya'ni trail'ni yozgan huquq uni tozalay olmaydi. `GET /audit-logs` (OWNER + SUPERADMIN,
  tenant-scoped, pagination, entityType/entityId/userId/action/sana filtri) + web sahifasi
  (i18n 3 tilda, menyuda). ·
  migratsiya `20260817160000_audit_log_immutable`, `audit.service.ts` (+spec 10 test),
  `audit.controller.ts`, `dto/list-audit.dto.ts`, `drivers/clients/vehicles/expenses`
  servislari, `apps/web/.../AuditLogPage.tsx` + i18n, `test/audit.e2e-spec.ts` (+10 e2e) ·
  unit 164 → 175, e2e 71 → 81. `expenses.service.ts` qamrovi 74% → 79% (branch 67% → 79%).

## Bloklangan / keyinga qoldirilgan

(sabab bilan)

- **Coverage 60% / 90% maqsadi** — hozir global 25% statements / 34% lines, `expenses.service.ts`
  51%. 60/90 ni bir taskda urish mumkin emas (keyingi fazalarning har bir taski test qo'shadi),
  shuning uchun threshold **ratchet** sifatida joriy darajadan sal pastga qo'yildi: coverage
  hech qachon pasaymaydi, har faza oxirida ko'tariladi. Maqsad PHASE 5 oxirida 60/90.

## Yangi topilgan muammolar

(audit hisobotida yo'q, ish davomida topilgan)

- **N-5 (HIGH, tuzatildi)**: `bootstrap.ts` `express`ni to'g'ridan-to'g'ri import qiladi, lekin
  `express` backend `dependencies`ida yo'q edi — dev'da hoisting tufayli ishlardi, prod
  konteynerida `Cannot find module 'express'` bilan yiqildi. Dependency qo'shildi.
- **N-4 (HIGH, tuzatildi)**: `nest build` `dist/src/main.js` yaratardi (tsconfig `include`ga
  `prisma` va `test` kirgani uchun `rootDir` paket ildiziga ko'tarilgan), ya'ni
  `package.json`dagi `"start": "node dist/main.js"` **hech qachon ishlamagan**.
  `tsconfig.build.json` + `nest-cli.json` qo'shildi → `dist/main.js`.
- **N-3 (CRITICAL, TUZATILDI — TASK-2.2)**: yangi e2e darhol C-1 davomini isbotladi — B tenant A'ning
  `tripId`/`clientId` bilan `POST /expenses` va `POST /incomes` yuborsa **201** qaytadi va yozuv
  yaratiladi. Ikkala test `it.failing()` bilan qoldirildi (hujjatlangan, bajariladigan zaiflik) —
  TASK-2.2 tuzatganda ular avtomatik qizil bo'ladi va `it()`ga qaytariladi.
- **N-2 (info)**: muhitda Flutter SDK yo'q edi — 3.47.0 stable `/opt/flutter`ga o'rnatildi, shuning
  uchun mobil gate (`flutter test`, `flutter analyze`) real ishlaydi.
- **N-1 (info)**: audit'ning baseline bashorati noto'g'ri (yuqoriga qara) — backend unit testlari
  jest `moduleNameMapper` tufayli yashil. Bu TASK-1.3 doirasini kamaytiradi, bekor qilmaydi.

## Keyingi qadam

### PHASE 3 — CORE BUSINESS

- **TASK-3.1 (H-3)** · Qarz/balans ledger'i. `ledger_entries` — **o'zgarmas** jurnal
  (`direction` DEBIT/CREDIT, `reason`, `amount`, `amountBase`, `rateUsed`/`rateDate`
  TASK-3.3 uchun tayyor, `reversedByEntryId`). RLS + append-only trigger (UPDATE/DELETE
  DB darajasida taqiqlangan — tuzatish faqat `REVERSAL` yozuvi bilan).
  Reys `COMPLETED` → `TRIP_INVOICED` DEBIT; kirim → `PAYMENT_RECEIVED` CREDIT — ikkalasi
  ham o'zgarish bilan **bitta tranzaksiyada**. Reysni logist ham, haydovchi ham
  yakunlashi mumkin, shuning uchun `invoiceCompletedTrip()` idempotent (ikki marta
  invoys qilmaydi). `Client.balance` kesh sifatida qoldi va faqat atomik `increment`
  bilan yangilanadi (DB-5 — read-modify-write emas). `GET /clients/:id/ledger` va
  `GET /clients/:id/balance` (`balance`, `debt`, `overdue` — to'lovlar eng eski
  invoysdan yopiladi). `Income.status` endi **hisoblanadi**: DTO'dan olib tashlandi,
  ledger'dan PAID/PARTIAL, web'da faqat `Badge` (avval `<Select>` bilan to'lanmagan
  reysni PAID qilish mumkin edi). To'lov summasi tuzatilsa — `REVERSAL` + yangi yozuv. ·
  migratsiyalar `*_ledger`, `20260817170000_ledger_rls`, `ledger/*` (service +spec 21 test),
  `trip-invoicing.ts`, `trips/events/expenses` servislari, `clients.controller.ts`,
  `tenant.extension.ts`, web `FinancePage.tsx`, `docs/BUSINESS-RULES.md` (yangi) ·
  unit 175 → 200, e2e 81 → 92. `expenses.service` qamrovi 83%, `ledger.service` 92%.
- **TASK-3.2 (H-2)** · Pul endpointlarida idempotency. `IdempotencyKey` modeli
  (`(companyId, key)` unique, `endpoint`, `requestHash`, `statusCode`, `responseBody`, TTL 24s).
  `IdempotencyInterceptor` kalitni **avval band qiladi**, keyin ishni bajaradi —
  tekshirib-keyin-yozish ikki bir vaqtdagi so'rovga teshik qoldirardi (aynan double-click).
  Takroriy so'rov saqlangan javobni oladi (bir xil `id`); boshqa payload bilan o'sha kalit →
  409 `IDEMPOTENCY_KEY_REUSED` (eski javobni qaytarish yangi to'lovni jimgina yo'qotardi);
  so'rov xato bersa kalit bo'shatiladi. `requestHash` kalit tartibiga bog'liq emas.
  Majburiy: `/expenses`, `/incomes`, `/trips`, `/trips/:id/complete`, `/expenses/:id/approve`
  (`/events/batch`da `clientEventId` allaqachon shu rolni bajaradi). Web `crud.ts` har
  mutatsiyada kalit yuboradi va **retry'da o'zgartirmaydi** (kalit `variables` obyektiga
  `WeakMap` orqali bog'langan — `mutationFn` ichida UUID yaratish retry'da yangi kalit
  berardi va butun mexanizmni bekor qilardi). Kunlik tozalash job'i. ·
  migratsiya `*_idempotency_keys`, `common/idempotency/*` (+spec 9 test),
  `expenses/trips` kontrollerlari, web `client.ts`/`crud.ts`,
  `test/idempotency.e2e-spec.ts` (+9 e2e), `docs/BUSINESS-RULES.md` ·
  unit 200 → 209, e2e 92 → 101.
- **TASK-3.3 (H-4)** · Ko'p valyuta: `ExchangeRate` modeli (`(currency, date)` unique,
  `rateToUzs Decimal(18,6)`, `source`; kompaniyalar orasida umumiy). Har money yozuvida
  **qotirilgan** `amountBase` (UZS tiyin) + `rateUsed` + `rateDate` — yozuv yaratilganda
  hisoblanadi va keyin o'zgarmaydi (kurs ertaga o'zgarsa o'tgan oy hisoboti o'zgarmaydi).
  `CurrencyService.toBase()`: UZS o'tib ketadi (`rateUsed = NULL` — kurs 1 emas, ya'ni
  konvertatsiya **bo'lmagan**), boshqasi uchun kurs topilmasa `EXCHANGE_RATE_MISSING`
  (422) va yozuv yaratilmaydi — taxminiy kurs ishlatilmaydi. Dam olish kunlari uchun
  eng yaqin oldingi kurs. Yaxlitlash `Decimal` + ROUND_HALF_UP (JS `number` yo'q).
  Konvertatsiya `expenses`, `incomes` va reys invoyslashga ulandi; ledger allaqachon
  `amountBase` bo'yicha ishlaydi. `POST /admin/exchange-rates` (SUPERADMIN) +
  `GET` ro'yxati; CBU.uz job'i uchun `upsertRate()` tayyor. Migratsiya mavjud qatorlarni
  `amount_base = amount` bilan to'ldirdi (izoh bilan asoslangan). ·
  migratsiya `*_exchange_rates`, `modules/currency/*` (+spec 12 test),
  `expenses.service.ts`, `trip-invoicing.ts`, `trips/events` servislari,
  `test/currency.e2e-spec.ts` (+7 e2e), `docs/BUSINESS-RULES.md` ·
  unit 209 → 221, e2e 101 → 108.

**PHASE 2 tugadi (9/9).** Keyingi: PHASE 3 — CORE BUSINESS, TASK-3.1 (qarz/balans ledger'i).
Tasdiq kutilmoqda.

**Keyingi qadam:** TASK-3.4 (reys status modeli: RETURNED / PARTIALLY_DELIVERED / FAILED).

PHASE 3 qolgan bog'liqliklar:

- TASK-3.3 (valyuta): ledger'da `amountBase`/`rateUsed`/`rateDate` maydonlari **allaqachon bor**
  va hozircha `amountBase = amount` (hammasi UZS deb faraz). 3.3 faqat konvertatsiyani
  to'ldiradi — migratsiya qayta yozilmaydi.
- TASK-3.5 (optimistic lock) `trips.service.transition()`ga tegadi — u TASK-1.4 da
  `events.service` bilan umumiy `trip-transitions.ts` orqali bog'langan, ikkalasini birga tekshir.
- TASK-3.4 (yangi status'lar) `packages/shared` enum'ini va web `StatusBadge`ni ham talab qiladi
  (API kontrakti).
