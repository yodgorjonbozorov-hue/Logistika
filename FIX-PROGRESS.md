# FIX PROGRESS

Boshlangan: 2026-08-17

## Holat

- [x] PHASE 0 — Baseline
- [x] PHASE 1 — Blockers (8 ta task)
- [x] PHASE 2 — Security (9 ta task)
- [x] PHASE 3 — Core business (12 ta task)
- [x] PHASE 4 — Performance (6 ta task)
- [x] PHASE 5 — UX (5 ta task)

## BEFORE (baseline, PHASE 0 / TASK-0.1)

Muhit: Node v22.22.2, pnpm 9.15.0, Docker 29.3.1 (daemon qo'lda ishga tushirildi),
`docker compose up -d` → postgres/redis/minio healthy.

| Gate buyrug'i                             | Natija                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm --filter shared build`              | OK (dist yaratildi)                                                                         |
| `pnpm --filter backend prisma generate`   | OK                                                                                          |
| `pnpm lint`                               | 0 xato                                                                                      |
| `pnpm --filter backend exec tsc --noEmit` | 0 xato                                                                                      |
| `pnpm --filter web exec tsc -b`           | 0 xato                                                                                      |
| `pnpm test`                               | backend **15/15 suite, 82 test o'tdi**; web 2 fayl, 11 test o'tdi; shared `tsc --noEmit` OK |
| `pnpm --filter backend test:e2e`          | **"No tests found, exiting with code 0"** — 0 e2e test                                      |
| `pnpm build`                              | OK (backend + web + shared)                                                                 |

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

- **Coverage 60% / 90% maqsadi** — TASK-3.6 dan keyin **haqiqiy** qamrov 37.5% statements /
  44.9% lines; `odometer.ts` 100%, `events.service.ts` 96%, `ledger.service.ts` 91%,
  `expenses.service.ts` 90%, `trips.service.ts` 76%.
  Diqqat: `package.json`dagi **`global` threshold raqami pasaydi** (30 → 28) — bu regressiya
  emas. Jest o'z threshold'i bor faylni global hisobdan **chiqarib tashlaydi**, shuning uchun
  yaxshi qoplangan fayllar per-file ratchet'ga o'tgach global guruhda faqat qolganlari qoladi.
  Per-file ratchet global'dan qat'iyroq himoya.
  60/90 ni bir taskda urish mumkin emas (keyingi fazalarning har bir taski test qo'shadi),
  shuning uchun threshold **ratchet** sifatida joriy darajadan sal pastga qo'yildi: coverage
  hech qachon pasaymaydi, har faza oxirida ko'tariladi. Maqsad PHASE 5 oxirida 60/90.

## Yangi topilgan muammolar

(audit hisobotida yo'q, ish davomida topilgan)

- **N-14 (MEDIUM, tuzatildi — TASK-5.3)**: `IsTiyin` **`0` ni qabul qilardi** —
  nol so'mlik xarajat/kirim/reys narxi yaroqli so'rov edi. Hech narsani
  anglatmaydigan qator, lekin har o'rtachani jimgina kengaytiradi; ledger esa
  nolni allaqachon rad etadi. Klient validatsiyasini backend bilan solishtirib
  ko'rilganda topildi (klient serverdan qattiqroq bo'lib qolgandi).
  `IsPositiveTiyin` qo'shildi. Haydovchi avansida `0` — «avans yo'q» degan
  haqiqiy javob, o'zgarmadi.
- **N-13 (HIGH, tuzatildi — TASK-4.6)**: `GET /trips` — **ilovada eng ko'p
  ochiladigan ekran** — o'z tartiblashi uchun indekssiz edi. Filtersiz ro'yxat
  firmaning butun reys tarixini `Seq Scan` qilib, yigirmata qator qaytarish
  uchun hammasini saralardi: 18k qatorda **13.8 ms va 670 bufer**, narx firma
  tarixi bilan chiziqli o'sadi. Kodni o'qib emas, **o'lchab** topildi.
  `(company_id, created_at DESC)` indeksi: **0.13 ms, 23 bufer**.
  `(company_id, status, created_at DESC)` varianti ham o'lchandi — planner uni
  hech qachon tanlamadi, shuning uchun qo'shilmadi.
- **N-12 (HIGH, tuzatildi — TASK-4.3)**: qo'lda yozilgan migratsiyalarda
  yaratilgan uchta indeks `schema.prisma`da **e'lon qilinmagan** edi
  (`gps_tracks (vehicle_id, recorded_at DESC)`, `gps_tracks (trip_id)`,
  `clients (company_id, is_active)`). Prisma sxemani haqiqat deb biladi, shuning
  uchun **keyingi har bir `migrate dev` ularni `DROP INDEX` qilishni taklif
  qilardi** — TASK-4.1 ning butun ishini bekor qiladigan indekslar shular edi.
  Bu safar migratsiya generatsiyasida ko'rindi va sxemaga e'lon qo'shildi.
  Qoida: qo'lda yozilgan migratsiya indeks yaratsa, u **sxemada ham** bo'lishi shart.
- **N-11 (MEDIUM, ochiq)**: `tracking.service.ts` — jonli xaritaga oxirgi hodisani
  qo'shadigan qidiruv faol reyslarning **barcha** hodisalarini o'qib, Prisma'ning
  klient tomonidagi `distinct`i bilan siyraklashtiradi. TASK-4.1 dagi `gps_tracks`
  muammosining kichik nusxasi: hozir zararsiz (faol reys kam), lekin uzoq reyslarda
  o'sadi. TASK-4.2 doirasida **ataylab tegilmadi** — yarim tuzatish o'rniga alohida
  task bo'lishi kerak (denormalizatsiya yoki `DISTINCT ON` raw so'rov).
- **N-10 (HIGH, tuzatildi — TASK-4.2)**: **sahifalash umuman ishlamagan.**
  `PaginationDto.skip` **getter** edi, `IntersectionType(PaginationDto, DateRangeDto)`
  esa sinfni uning o'z xossalaridan qayta quradi — prototip getter'i o'z xossasi emas.
  Shu sababli `ListTripsDto`, `ListEventsDto`, `ListLedgerDto`, `ListAuditLogsDto`
  getter'ni yo'qotgan va Prisma `skip: undefined` olgan; Prisma uni e'tiborsiz
  qoldiradi, ya'ni `?page=2`, `?page=7` — hammasi **1-sahifani** qaytargan. Hech qanday
  xato otilmagan, `total` ham to'g'ri ko'ringan. Baseline'dan beri mavjud edi.
  Getter → `skipOf(dto)` funksiyasiga aylantirildi (`readPage()` — yagona chaqiruv
  nuqtasi). Testlarda `skip` endi qo'lda berilmaydi: aynan qo'lda berilgan `skip`
  bu xatoni yashirib turgan edi.
- **N-9 (info)**: `flutter analyze` har ishga tushganda `analysis_options.yaml`ga
  `analyzer.exclude` blokini o'zi qo'shadi (build/android/ios/... papkalari). Bu Flutter
  tool'ining o'zgarishi, qo'lda yozilgani emas — qayta-qayta paydo bo'lmasligi uchun
  commit qilindi.
- **N-8 (MEDIUM, ochiq)**: `pnpm format:check` **baseline'dan beri qizil** — 35 faylda
  Prettier farqi bor (`docs/*`, `pnpm-lock.yaml`, eski manba fayllar). Butun repo'ni
  formatlash bu fazadagi diff'ni o'qib bo'lmas holga keltiradi, shuning uchun har taskda
  **faqat o'zim tekkan fayllar** formatlanadi. Repo bo'ylab bir martalik
  `pnpm format` — PHASE 5 oxirida, alohida commit bilan.
- **N-7 (HIGH, tuzatildi — TASK-3.5)**: web `useTripMutations` `POST /trips` va
  `/trips/:id/complete|finish`ga `idempotency-key` **yubormasdi**, holbuki bu endpointlar
  TASK-3.2 dan beri uni majburiy qiladi — ya'ni web'dan reys yaratish va yakunlash
  400 `VALIDATION_FAILED` bilan qaytardi. `keyFor()` `crud.ts`dan eksport qilindi va
  trips mutatsiyalariga ulandi.
- **N-6 (HIGH, tuzatildi — TASK-3.5)**: `updateExpense`/`updateIncome` summa o'zgarganda
  `amountBase`ni **qayta hisoblamasdi** — qator «200 USD» va eski summaning tiyinini bir
  vaqtda saqlab qolardi, hisobotlar esa aynan `amountBase`ni yig'adi. `reconvert()`
  qo'shildi: faqat summa/valyuta/sana o'zgarganda qayta qotiradi (aks holda qotirilgan
  kurs joyida qoladi — hisobot o'tmishda o'zgarmasligi kerak).
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
- **TASK-3.4 (H-7)** · Reys status modeli hayotga moslandi: `TripStatus`ga
  `PARTIALLY_DELIVERED`, `RETURNED`, `FAILED` qo'shildi (migratsiya + `packages/shared`
  enum'i — API kontrakti). `IN_PROGRESS` endi `COMPLETED | PARTIALLY_DELIVERED |
RETURNED | FAILED | CANCELLED`ga o'tadi (avval **faqat** `COMPLETED` — ya'ni buzilgan
  reysni «yetkazildi» deb yozishga majbur edi). `Trip.statusReason` + `statusChangedAt`
  - `deliveredAmount`; salbiy yakunlar uchun sabab majburiy (`@MinLength(10)`).
    `POST /trips/:id/finish` (OWNER/LOGIST, idempotent). Moliyaviy qoida kodda:
    COMPLETED → to'liq invoys, PARTIALLY_DELIVERED → faqat `deliveredAmount`,
    RETURNED/FAILED → invoys yo'q (xarajatlar zarar bo'lib qoladi — yashirilmaydi),
    CANCELLED → avans berilgan bo'lsa qaytarish yozuvi. Web `StatusBadge` + i18n × 3. ·
    migratsiya `*_trip_outcomes`, `trip-transitions.ts`, `trips.service.ts`,
    `trips.controller.ts`, `trip.dto.ts`, `packages/shared`, web `StatusBadge.tsx` + locales,
    `test/trip-outcomes.e2e-spec.ts` (+10 e2e), `docs/BUSINESS-RULES.md` ·
    e2e 108 → 118.
- **TASK-3.5 (H-1)** · Race condition: har bir «o'qi → qaror qil → yoz» yozuvi atomik
  qilindi. `Trip`, `Expense`, `Income`ga `version Int @default(0)` (+ `updatedAt`
  `Trip`/`Expense`/`Income`/`Client`/`Driver`/`Vehicle`/`TripEvent`ga — **M-18 ham
  yopildi**). `trips.transition()` endi `updateMany({ where: { id, status: <kutilgan> },
data: { …, version: { increment: 1 } } })` — kutilgan status **WHERE ichida**, shuning
  uchun ikki parallel `complete`dan aynan bittasi mos keladi; `count === 0` → 409
  `TRIP_INVALID_STATUS`. Guard tranzaksiya **ichida**, invoyslashdan **oldin** — yutqazgan
  so'rov mijozni ikkinchi marta hisob-kitob qilmaydi. `trips.update()` ixtiyoriy `version`
  qabul qiladi → mos kelmasa 409 `RESOURCE_CONFLICT` (yangi kod, i18n × 3).
  Shu naqsh butun bazaga qo'llandi: `expenses.approveExpense` (`isApproved: false` guard),
  `updateExpense` (`isApproved: false` + `version`), `removeExpense` (`deleteMany` guard —
  tasdiqlash o'chirish bilan poyga qilsa tasdiqlash yutadi), `updateIncome` (`version` —
  ikki tuzatish bir xil ledger yozuvini ikki marta `REVERSAL` qilardi).
  Web: `ApiError` endi HTTP status'ni olib yuradi, `isConflict()` + `onConflictRefetch()` —
  409 kelganda barcha mutatsiyalar avtomatik `invalidateQueries` qiladi, ekrandagi
  eskirgan nusxa yangisiga almashadi; xabar backend'dan (3 tilda) keladi. ·
  migratsiyalar `20260817180000_optimistic_locking`, `20260817160125_money_optimistic_locking`,
  `trips.service.ts`, `expenses.service.ts`, `trip.dto.ts`, `packages/shared`,
  `apps/web/.../client.ts`, `crud.ts`, `features/trips/api.ts`,
  `test/optimistic-locking.e2e-spec.ts` (+5 e2e, hammasi haqiqiy `Promise.all` bilan) ·
  unit 221 → 230, e2e 118 → 123. `expenses.service` qamrovi 83% → 90%,
  `trips.service` uchun yangi threshold qo'yildi (ratchet).
  Guard olib tashlanib tekshirildi: guardsiz `optimistic-locking` e2e **qizil** bo'ladi
  (ikkita `TRIP_INVOICED` yozuvi) — ya'ni test haqiqatan ham bu xatoni ushlaydi.
- **TASK-3.6 (DB-4, M-14)** · Spidometr va qiymat cheklovlari, ikki qatlamda.
  **Kod**: `common/odometer.ts` — bitta manba (`isOdometerOrderValid`,
  `odometerDistanceKm`, `assertOdometerOrder`), logist yo'li ham, haydovchi yo'li ham
  shu yerdan o'tadi. `end < start` → 400 `ODOMETER_INVALID` (yangi kod, i18n × 3,
  xabarda **ikkala ko'rsatkich** bor — haydovchi qaysi ikki raqam mos kelmayotganini
  bilishi kerak). `NULL` o'tadi: yozilmagan ko'rsatkich noto'g'ri emas, yo'q.
  `trips.finish()` endi masofani ham yozadi (avval faqat `complete` yozardi — yomon
  tugagan reys ham km bosib o'tgan va yoqilg'isi shunga o'lchanadi).
  `/events/batch` bunday `FINISH`ni **rad etadi** va hodisani umuman saqlamaydi;
  avval qabul qilinib masofa jimgina bo'sh qolardi — reys «tugagan» ko'rinib,
  har qanday km-hisobotidan tushib qolardi.
  **Baza**: `20260817190000_value_check_constraints` — 12 ta `CHECK`
  (`trips` odometr tartibi + odometr/masofa/pul ≥ 0 + `delivered_amount <= agreed_price`,
  `expenses`, `incomes`, `fuel_logs` (`liters > 0`), `ledger_entries` (ishorani
  `direction` tashiydi), `exchange_rates` (`rate_to_uzs > 0`)). Yozishdan oldin
  mavjud qatorlar tekshirildi — hech biri buzmaydi.
  **Mobil**: `permanentRejections` — `ODOMETER_INVALID` darhol «e'tibor talab qiladi»ga
  tushadi (o'sha noto'g'ri raqamni qayta yuborish hech qachon o'tmaydi; 5 urinish ×
  2 soat faqat haydovchining xabar topishini kechiktirardi). `NOT_FOUND` va
  `TRIP_INVALID_STATUS` ataylab bunga kirmadi — ular server holatiga bog'liq va
  holat qaytishi mumkin. Profil ekranida xom kod o'rniga tarjima qilingan matn
  (i18n × 3). ·
  `common/odometer.ts` (+spec 11 test), `trips.service.ts`, `events.service.ts`,
  `packages/shared`, i18n × 3, `offline_queue.dart`, `profile_tab.dart`,
  `app_strings.dart`, `test/value-constraints.e2e-spec.ts` (+13 e2e) ·
  unit 230 → 250, e2e 123 → 136, `flutter test` 23/23, `flutter analyze` toza.
  `trips.service` qamrovi 68% → 76%, `events.service` 96%, `odometer.ts` 100%.

**PHASE 2 tugadi (9/9).** Keyingi: PHASE 3 — CORE BUSINESS, TASK-3.1 (qarz/balans ledger'i).
Tasdiq kutilmoqda.

- **TASK-3.7 (M-13)** · Reys raqamlash. `count() + 1` ikki xil buzilardi: reys
  o'chirilsa bo'shagan raqamni keyingisi olardi (ikki reys hujjatda bir xil raqam bilan),
  va bir soniyadagi ikki yaratish bir xil `count()`ni o'qib bir xil raqamni so'rardi —
  atrofidagi retry sikli uch marta urinib, keyin xom unique-constraint xatosini
  foydalanuvchiga uzatardi.
  `trip_counters` jadvali (`(company_id, year)` kalit) — **sanalmaydi, oshiriladi**:
  `ON CONFLICT … DO UPDATE SET last_number = last_number + 1`. Oshirish qatorni
  tranzaksiya oxirigacha qulflaydi, ikkinchi yaratuvchi navbatda kutadi. Raqam va
  reysning o'zi bitta tranzaksiyada. Bo'shliq qabul qilinadi (raqam olib yiqilgan
  tranzaksiya bittasini ishlatmay qoldiradi) — bo'shliq hech kim ishlatmagan raqam,
  takror esa o'zini bitta deb da'vo qilayotgan ikki reys.
  Format `TR-2026-0042`: yil kalitning bir qismi, ketma-ketlik har yanvarda qaytadan
  boshlanadi; 4 xonaga to'ldiriladi (matn sifatida ham to'g'ri saralanadi), oshsa
  kesilmaydi. Yil **UTC** bo'yicha. Migratsiya mavjud reyslar sonidan hisoblagichni
  to'ldiradi — birinchi yangi raqam ketma-ketlikni davom ettiradi. `trip_counters`
  `TENANT_MODELS`ga qo'shildi va `tenant_isolation` RLS siyosatini oldi (hisoblagich
  kompaniya qancha reys qilishini aytadi). Web'da ortiqcha `№` prefiksi olib tashlandi —
  raqam endi o'zini o'zi tanitadi. ·
  migratsiya `20260818061308_trip_counter`, `schema.prisma`, `trip-numbering.ts`
  (+spec 6 test), `trips.service.ts`, `tenant.extension.ts`, `tenant-db.mock.ts`,
  web `TripsPage/TripDetailPage/MapPage`, `test/trip-numbering.e2e-spec.ts` (+6 e2e) ·
  unit 250 → 256, e2e 136 → 142. `trip-numbering.ts` 100%, `trips.service` 76% → 77%.
  Tekshirildi: atomik `increment` o'rniga read-then-write qo'yilsa, 10 parallel
  yaratish testi **qizil** bo'ladi (takroriy raqamlar).

- **TASK-3.8 (H-6)** · Offline sinxronizatsiya idempotentligi. `ingestBatch` avval
  `findMany` bilan mavjud `clientEventId`larni o'qib, keyin yozardi — ikki paket birga
  kelsa (ilova navbatni tozalaydi, ayni paytda ulanish kuzatuvchisi ham ishga tushadi)
  ikkalasi ham «yo'q» deb topib ikkalasi ham yozishga urinardi. Unique indeks ikkinchisini
  to'xtatardi, lekin xatosini **hech kim ushlamasdi**: butun paket 500 bilan yiqilardi va
  ilova aynan kerakli ishni qilib o'sha paketni cheksiz qayta yuborardi.
  Endi dublikat — yozuvning o'zi rad etgan narsa: `P2002` (`client_event_id` bo'yicha) →
  `duplicates`. Tekshiruv ataylab tor — boshqa unique buzilishi haqiqiy bug va ko'tariladi;
  tarmoq uzilishi ham dublikat emas (uni shunday hisoblash telefonni server saqlamagan
  hodisani o'chirishga majbur qilardi). `findMany` qoldi, lekin faqat arzon birinchi filtr.
  Kalitning o'zida ikki xato bor edi: **`NULL` bo'lishi mumkin edi** (bo'lishi shart
  bo'lmagan kalit hech narsani deduplikatsiya qilmaydi, PostgreSQL har `NULL`ni alohida
  deb biladi — bunday qatorlar umuman himoyasiz edi; DTO uni har doim talab qilgan) va
  **global unique edi** (bir tenant id'lari boshqasi nima saqlashini hal qilardi — boshqa
  kompaniya id'sini bilgan haydovchi o'z hodisasini «allaqachon ko'rilgan» deb rad
  ettirishi mumkin edi). Endi `@@unique([companyId, clientEventId])` + `NOT NULL`.
  Migratsiya `NULL` kalitlarni generatsiya qilingan UUID bilan to'ldiradi (hech bir telefon
  navbatiga mos kelmaydi — ular allaqachon qanday bo'lsa shunday qoladi). ·
  migratsiya `20260818070000_event_idempotency_key`, `schema.prisma`, `events.service.ts`,
  `prisma/seed.ts`, `test/query-validation.e2e-spec.ts`,
  `test/event-idempotency.e2e-spec.ts` (+5 e2e, `Promise.all` bilan) ·
  unit 256 → 261, e2e 142 → 147. `events.service` qamrovi 96% → 97% (branch 100%).
  Tuzatishdan **oldin** yozilgan e2e 5 tadan 4 tasi qizil edi — ya'ni testlar aynan shu
  xatoni ushlaydi.

- **TASK-3.9 (H-9)** · Obuna tekshiruvi. `Company.isActive` va `subscriptionUntil`
  birinchi migratsiyadan beri bor va SUPERADMIN ularni to'ldiradi, lekin **hech kim
  o'qimasdi** — to'lashni to'xtatgan yoki butunlay o'chirilgan kompaniya har bir
  endpoint'dan to'liq foydalanaverardi.
  `SubscriptionGuard` global guard sifatida qo'shildi (JWT'dan **keyin**, rollardan
  **oldin** — o'chirilgan kompaniya qanday rol bo'lishidan qat'i nazar rad etiladi).
  Ikki holat, ataylab har xil javob: `isActive = false` → 403 `COMPANY_INACTIVE`,
  hech narsa mumkin emas (bu ma'muriy qaror, to'lov holati emas); muddati o'tgan →
  **o'qish ishlaydi, yozish yo'q** (402 `SUBSCRIPTION_EXPIRED`). Muddati o'tgan firmani
  o'z ma'lumotidan uzish jazo bo'lardi, undiruv emas — u o'z reyslarini ocholmaydi va
  yozuvlarini eksport qilolmaydi; to'xtashi kerak bo'lgan narsa faqat **yangi** yozuv.
  `subscriptionUntil = NULL` cheklov emas (sinov davri va eski tenantlar).
  SUPERADMIN va `@Public()` marshrutlar chetda — aks holda muddati o'tgan kompaniya
  nega o'tganini bilish uchun ham kira olmasdi.
  O'qish o'tib ketgani uchun javob buni aytadi: `meta.subscription = { expired, until }`
  (aks holda ofis hamma narsa yuklanayotganini ko'radi va muammoni faqat birinchi
  saqlash yiqilganda biladi). Kesh 60 s (tekshiruv har so'rovda kerak), SUPERADMIN
  o'zgartirsa **darhol** tozalanadi, `expired` esa keshdan qayta hisoblanadi — obuna
  o'z sanasidan bir daqiqa ortiq yashay olmaydi. Mavjud bo'lmagan kompaniya
  `isActive: false` (bu yerda «ochiq» yiqilish o'chirilgan tenantni eng imtiyozli
  qilib qo'yardi). Yangi kodlar `SUBSCRIPTION_EXPIRED` (402) va `COMPANY_INACTIVE`
  (403) — i18n × 3. ·
  `common/subscription/*` (service + guard + module, +21 unit test), `app.module.ts`,
  `api-response.interceptor.ts` (+spec), `companies.service.ts` (kesh invalidatsiyasi),
  `packages/shared`, i18n × 3, `test/subscription.e2e-spec.ts` (+11 e2e) ·
  unit 261 → 288, e2e 147 → 158. Uch yangi fayl 100% statement/line qamrov.

- **TASK-3.10 (M-7, M-8)** · Ikki marta band qilish va band resursni o'chirish.
  **(a)** Buxoroga yarim yo'lda ketayotgan mashinada ikkinchi reysni boshlashga hech narsa
  to'sqinlik qilmasdi — keyin ikkala reys ham bir xil GPS trek, yoqilg'i va kilometrni
  yig'ardi, ikkalasining foydasi ham hech bir hisobot ko'rsata olmaydigan tarzda noto'g'ri
  chiqardi. Chegara `IN_PROGRESS`da, **ataylab**: bir necha reysga _biriktirilgan_ bo'lish
  oddiy rejalashtirish (bugun ketayotgan mashinaga ertangi reys yoziladi), ikki reysda
  _ketayotgan_ bo'lish esa jismonan mumkin emas. Haydovchi, mashina **va tirkama** uchun.
  Kafolat — uchta **qisman unique indeks** (`WHERE status = 'IN_PROGRESS'`), chunki koddagi
  tekshiruvdan ikki parallel `start` ikkalasi ham o'tadi. Koddagi tekshiruv esa
  to'sqinlik qilayotgan reysni **nomlaydi** («TR-2026-0041 reysida» foydali, «unique
  constraint violated» yo'q). Yutqazgan so'rov `DRIVER_BUSY`/`VEHICLE_BUSY` (409, yangi
  kodlar, i18n × 3) oladi, 500 emas; haydovchi paketida esa `rejected` bo'ladi, butun paket
  yiqilmaydi.
  Diqqat: Prisma qisman indeksni **bilmaydi**, shuning uchun `P2002`da indeks nomi emas,
  ustun nomlari keladi (`["company_id","driver_id"]`) — buni haqiqiy insert bilan
  tekshirdim va moslashtirish aynan shu to'plam bo'yicha yozildi.
  **(b)** Haydovchini yo'l o'rtasida o'chirish mumkin edi. `listMine` va
  `requireDriverProfile` ikkalasi ham `isActive` bo'yicha filtrlaydi — telefonda reys
  yo'qoladi va har bir hodisa rad etiladi, ya'ni reysning qolgan qismidagi cheklar va
  yetkazish isboti umuman yozilmaydi. Endi `ASSIGNED` yoki `IN_PROGRESS` reysi bor
  haydovchi/texnikani o'chirish `RESOURCE_IN_USE` (409) beradi, `details`da reys raqami
  bilan. Rejalashtirilgan reys ham hisobga olinadi: haydovchisi o'chirilgan `ASSIGNED`
  reys — hech qachon boshlanmaydigan reys. ·
  migratsiya `20260818080000_one_trip_at_a_time`, `common/trip-availability.ts`
  (+spec 11 test), `trip-transitions.ts` (`ACTIVE_TRIP_STATUSES`), `trips.service.ts`
  (`transition` → `runTransition` ga ajratildi), `events.service.ts`,
  `drivers.service.ts` (+spec 5), `vehicles.service.ts` (+spec 4), `packages/shared`,
  i18n × 3, `test/availability.e2e-spec.ts` (+9 e2e), `test/audit.e2e-spec.ts` (fixture) ·
  unit 288 → 310, e2e 158 → 167. `trip-availability.ts` 100%, `events.service` 97%.

- **TASK-3.11 (M-9)** · Katalogni yumshoq o'chirish — va uni haqiqiy qilish.
  **(a)** `Driver` va `Vehicle` boshidanoq yumshoq o'chirilardi, `Client` esa qattiq
  `DELETE` bilan. Tashqi kalitlar reysi bor mijozni o'chirishga yo'l qo'ymasdi va aynan
  shu haqiqiy muammoni **yashirardi**: hech narsa biriktirilmagan mijoz uchun o'chirish
  **muvaffaqiyatli** bo'lardi va qator butunlay yo'qolardi — kontragent mavjud
  bo'lganidan qolgan yagona iz audit'dagi `before` edi. Endi `Client.isActive`;
  `DELETE /clients/:id` marshruti o'sha-o'sha, lekin nafaqaga chiqaradi.
  Rad etish sabablari (ikkalasi ham puldan ko'z uzmaslik haqida): **balans nolga teng
  emas** (nafaqaga chiqarilgan mijoz ro'yxatdan tushadi, qarz ham u bilan birga) va
  **rejalashtirilgan/ketayotgan reysi bor** (invoysi hali chiqarilmagan yoki
  to'lanmagan). Bu TASK-3.10 dagi qoidaning bir xil shakli.
  **(b)** Muhimroq yarmi: nafaqaga chiqarilgan yozuv **har bir ro'yxatda va tanlovda**
  qolardi — kompaniyani tark etgan haydovchini ertangi reysga qo'yish mumkin edi.
  Hali ham tayinlanishi mumkin bo'lgan yozuv — bayroq, yumshoq o'chirish emas, va u
  TASK-3.10 ning yo'l o'rtasidagi himoyasini eskirgan ro'yxatdan tanlash orqali bekor
  qilardi. `CatalogueListDto` (`includeInactive`, default `false`) uchala katalogga
  qo'llandi; `count` ham **shu to'plamni** sanaydi (aks holda jadvalning oxirgi sahifasi
  bo'sh chiqadi); reysga **yangi** biriktirish nafaqaga chiqarilgan resurs bilan
  `RESOURCE_IN_USE` (409) beradi. Faqat yangi majburiyat tekshiriladi — haydovchisi
  ishdan ketgan **tugagan** reysga chek yozish qabul qilinaveradi, u chek tarix.
  Diqqat: tekshiruv `isActive === false` (shunchaki falsy emas) — ustunsiz o'qilgan
  qator nafaqaga chiqarilganlik dalili emas. ·
  migratsiya `20260818090000_client_soft_delete`, `schema.prisma`,
  `common/dto/catalogue.dto.ts` (+spec 4), `clients.service.ts` (+spec 10),
  `clients/drivers/vehicles` servis va kontrollerlari, `trips.service.ts`
  (`assertRefsActive`), `test/soft-delete.e2e-spec.ts` (+10 e2e) ·
  unit 310 → 332, e2e 167 → 177. `catalogue.dto.ts` 100%, `trips.service` 80%.

- **TASK-3.12 (M-2..M-6, M-15, M-22, L-1, L-2, L-8, L-9)** · O'n bitta mayda tuzatish,
  bitta commitda, har biri o'z testi bilan.
  **M-22** `forbidNonWhitelisted: true` — ortiqcha maydon endi jimgina tashlanmaydi
  (`amout` deb yozgan klient 201 va nol summali xarajat olardi). Buzuvchi o'zgarish
  bo'lgani uchun web va mobil so'rovlari tekshirildi; bitta haqiqiy muammo topildi —
  kirim formasi hali ham `status` yuborardi, holbuki u TASK-3.1 dan beri ledger'dan
  hisoblanadi. Tanlov formadan olib tashlandi.
  **M-6** `ListTripsDto` endi `DateRangeDto` bilan birlashadi — `?from=kecha` avval
  `Invalid Date` bo'lib Prisma'ga borardi va **500** qaytarardi.
  **M-5 / L-9** `IsWithinDateWindow` dekoratori: `expenseDate`/`paymentDate` ertagagacha
  (ofis va haydovchi yarim tundan ikki tomonda), `eventTime` +5 daq … −30 kun. Telefon
  soati noto'g'ri bo'lishi kamdan-kam emas — bir hafta o'chib turgan qurilmaning odatiy
  holati, va 1970 sanali hodisa hech qayerda xatoga o'xshamaydi. `TripEvent.receivedAt`
  (server vaqti) qo'shildi: kech sinxronizatsiyani noto'g'ri soatdan ajratishning yagona
  yo'li.
  **M-3** `normalizePhone()` (E.164): `+998901234567` / `998901234567` / `901234567` /
  `90 123 45 67` — bitta raqam va **to'rtta akkaunt** edi. DTO transform'ida, bazaga faqat
  normallashtirilgan holda, `findByIdentifier` ham normallashtiradi, mavjud qatorlar
  migratsiyada tozalandi. Chet el raqami tegilmaydi — `+998` taxmin qilish qozog'istonlik
  haydovchining ishlaydigan raqamini boshqa birovnikiga aylantirardi.
  **M-2 / L-2** `User.tokenVersion`: access token 15 daqiqa yashaydi va uni o'ldirishi
  kerak bo'lgan har bir qarordan omon qolardi. Rol o'zgarishi, deaktivatsiya, parol
  o'zgarishi va chiqishda oshiriladi; deaktivatsiyada refresh tokenlar ham bekor qilinadi
  (avval o'chirilgan akkaunt o'ziga yangi access token chiqarib olardi). Chiqish **barcha**
  seanslarni tugatadi — umumiy telefonda bu aynan chiqish bartaraf qilishi kerak bo'lgan
  xavf. Kesh 30 s, lekin versiyani oshiradigan har bir yo'l keshni darhol tozalaydi.
  **M-4** `photo_urls` ustuni har doim StoredFile **id**larini saqlagan — nomi yolg'on edi.
  `photo_file_ids`ga qayta nomlandi (hali hech bir klient o'qimaydi, ya'ni buni haqiqatga
  aylantirishning oxirgi arzon payti); `resolvePhotoKeys` → `resolvePhotoFileIds`.
  Yo'l-yo'lakay: begona fayl id'si endi hodisani **rad etadi**, avval chek jimgina tashlab
  yuborilardi — chek esa isbotning o'zi.
  **L-1** `GET /company` (INN, manzil, tarif, obuna) endi faqat `OWNER`/`LOGIST`/`ACCOUNTANT`.
  **L-8** Xarajatni tuzatish: `amount` ataylab ishorasiz va tasdiqlangan xarajat o'zgarmas —
  ikkalasi birgalikda tuzatishning **umuman iloji yo'q**ligini anglatardi. `POST
/expenses/:id/reverse` teskari yozuv yaratadi (ledger naqshi): original qanday yozilgan
  bo'lsa shunday qoladi, juftlik nolga yig'iladi. `reversal_of_id` unique + self-FK +
  `CHECK` (o'zini bekor qilmaydi); sabab majburiy.
  **M-15** `Document` polimorf egasi — **qaror**: alohida FK'li jadvallarga bo'lish to'rtta
  deyarli bir xil jadval evaziga bo'ladi va «muddati tugayotgan barcha hujjatlar» so'rovini
  `UNION`ga aylantiradi. Orphan ikki uchidan oldi olinadi: modul egani tekshiradi, va
  TASK-3.10/3.11 dan keyin egalar umuman o'chirilmaydi. `Document` moduli hali yozilmagan —
  qoida `schema.prisma` izohida va BUSINESS-RULES §12 da qoldirildi. ·
  migratsiyalar `*_event_received_at`, `*_photo_file_ids`, `*_normalize_phones`,
  `*_token_version`, `*_expense_reversal`, `common/phone.ts` (+spec 16),
  `common/dto/date-bounds.ts` (+spec 11), `common/auth/token-version.*` (+spec 8),
  `bootstrap.ts`, `jwt-auth.guard.ts`, `auth/users/expenses/events/companies` modullari,
  web `FinancePage.tsx`, `test/small-fixes.e2e-spec.ts` (+22 e2e) ·
  unit 332 → 375, e2e 177 → 199. `phone.ts`, `date-bounds.ts`, `token-version.service.ts`,
  `events.service.ts` — 100%.

- **TASK-4.1 (H-8, L-5)** · Jonli xarita so'rovi — PHASE 4 ning eng yirik muammosi.
  **BEFORE (o'lchandi, 40 mashina × 90 kun × 30s = 10 368 000 qator, 3.8 GB):**
  `live()` — `Parallel Seq Scan` + butun jadval `Sort`i, **`LIMIT` yo'q**, cost 2 122 483,
  **10 daqiqada tugamadi**. Sabab: Prisma'ning `distinct`i **klientda** deduplikatsiya
  qiladi, ya'ni 40 qatorni ko'rsatish uchun 10.4 million qator tarmoqdan o'tadi — va
  xarita buni har 30 soniyada so'raydi. `history()` 90 kun — `Index Scan`, 258 759 qator,
  bitta JSON javobda.
  **Yechim**: `Vehicle`ga `lastLat`/`lastLng`/`lastSpeed`/`lastSeenAt`/`lastTripId`
  denormalizatsiyasi, har pozitsiya paketi oxirida **har mashina uchun bitta** `update`
  (500 nuqta, 4 mashina = 4 yozuv). `live()` endi `gps_tracks`ga umuman tegmaydi.
  Nozik joy: yozuv `lastSeenAt < yangi vaqt` sharti bilan — offline turgan telefon
  navbatini kech bo'shatganda o'sha nuqtalar xaritadagidan eskiroq va markerni orqaga
  sudrardi. Migratsiya mavjud qatorlarni `DISTINCT ON` bilan to'ldiradi, ya'ni xarita
  deploydan keyingi birinchi so'rovdayoq to'g'ri.
  `history()`: oyna **≤ 31 kun** (oshsa 400), `take` = 100 001 qator, javob **2 000
  nuqtagacha siyraklashtiriladi**. Kesib tashlash emas — kesilgan marshrut yolg'on, u
  mashina chegara tugagan joyda to'xtagandek ko'rsatadi; ikkala uchi ham saqlanadi.
  Javob shakli `{ points, totalPoints, truncated }` (buzuvchi — web moslashtirildi).
  Indekslar: `(vehicle_id, recorded_at DESC)` va `(trip_id)` (L-5).
  **AFTER (o'sha 10.4M qatorda):** `live()` **0.086 ms** (17 buffer) — 10+ daqiqadan;
  `history()` 31 kun **1 080 ms**, 89 280 qator o'qilib 2 000 ga siyraklashtiriladi. ·
  migratsiya `20260818150000_vehicle_last_position`, `schema.prisma`,
  `tracking.service.ts` (+spec 26 test), web `MapPage.tsx`,
  `test/tracking-perf.e2e-spec.ts` (+8 e2e), `tenant-isolation`/`query-validation` e2e
  (yangi javob shakli) · unit 375 → 393, e2e 200 → 208. `tracking.service` 90%.

- **TASK-4.2 (H-9, M-19)** · `count()`lar, N+1 va — yo'l-yo'lakay — **sahifalashning o'zi**.
  Ish davomida ma'lum bo'ldiki `PaginationDto.skip` getter'i `IntersectionType` bilan
  yig'ilgan har bir DTO'da yo'qolgan va `?page=2` **1-sahifani** qaytargan (N-10, HIGH,
  baseline'dan beri). Getter → `skipOf(dto)`; `readPage()` yagona chaqiruv nuqtasi.
  **`count()` endi opsional**: `?withTotal=false` bo'lsa `count()` umuman bajarilmaydi va
  `total: null` qaytadi. `hasMore` har doim to'g'ri, chunki u sahifadan **bitta ortiq**
  qator o'qishdan keladi (`take = limit + 1`), `count()`dan emas — «keyingi sahifa»
  tugmasiga kerak bo'lgani ham shu. 11 ta ro'yxat servisi va 9 ta controller
  `readPage()`/`paginated()`ga o'tkazildi; `PaginationMeta.total` endi `number | null`,
  `hasMore` qo'shildi (`packages/shared`).
  **N+1 lar**: `events.batch` har hodisa uchun alohida `trip` va `file` so'rovi yuborardi
  (TASK-3.8 tuzatgan deb faraz qilingan edi — tekshirilganda **hali ham bor** edi) →
  reyslar va fayl id'lari bittadan so'rov bilan oldindan o'qiladi, status o'zgargan
  hodisadan keyin xotiradagi nusxa yangilanadi; `files.referencedFileIds` butun
  `trip_events`ni o'qish o'rniga jsonb `?|` bilan bazada (jonli bazada tekshirildi:
  mos 1, mos emas 0); `ledger.overdueFor` butun tarix o'rniga faqat DEBIT qatorlari +
  bitta CREDIT yig'indisi.
  Web: `useRefLists()` — `staleTime` 5 daqiqa va `withTotal: false` (picker hech qachon
  «1–100, jami 137» yozmaydi). ·
  `common/dto/pagination.dto.ts` (+spec 15 test), `packages/shared`, 11 servis + 9
  controller, `events.service.ts`, `files.service.ts`, `ledger.service.ts` (+4 test),
  `expenses.service.spec.ts` (+4), `trips.service.spec.ts` (+5),
  `test/pagination.e2e-spec.ts` (+6 e2e), web `features/trips/api.ts` ·
  unit 393 → 428, e2e 208 → 214. `ledger.service` 100%, `events.service` 100%.
  Ratchet ko'tarildi: events 100, ledger 100/90/100/100, expenses 95, trips 85,
  `pagination.dto` yangi.

- **TASK-4.3 (A-3, L-7)** · Fon ishlari — BullMQ nihoyat ishga tushdi.
  `bullmq` va `ioredis` boshidan `dependency`da edi va **hech qanday kod navbat
  ochmagan**: haydovchining fotosi `sharp` tugashini, kirish esa SMS-shlyuz
  javobini so'rov oqimida kutardi.
  `JobsService` — BullMQ bilan gaplashadigan **yagona joy**: `enqueue(navbat,
payload)`, `register(navbat, handler)`, va bitta umumiy siyosat — 3 urinish,
  eksponensial backoff (5 s), `removeOnComplete: 100`, `removeOnFail: 1000`,
  urinishlar tugagach **`<navbat>.dead`** ga ko'chirish (o'chmaydigan qilib —
  avtomatik o'chadigan o'lik xat hech kim qayta yubormaydigan o'lik xat).
  Navbatlar: `sms`, `files`, `gps-archive` (oxirgisi TASK-4.4 uchun).
  **Fayl**: tekshiruv/virus/kvota so'rovda qoladi (ular ruxsatni hal qiladi),
  siqish esa navbatga o'tdi. Nozik joy — buzuq rasm baribir **415** olishi kerak,
  shuning uchun `sharp().metadata()` bilan **sarlavha** so'rov ichida o'qiladi
  (mikrosoniyalar), og'ir `resize`/`jpeg` esa worker'da. Asl baytlar darhol
  saqlanadi: `PROCESSING` «hali siqilmagan» degani, «hali yo'q» degani emas —
  imzolangan havola shu daqiqadan ishlaydi. Siqib bo'lmagani `FAILED` bo'ladi va
  **asl nusxa qoladi**.
  **SMS**: `sms_messages` jadvali (`purpose`, `status`, `attempts`, `lastError`,
  `sentAt`) — **matn saqlanmaydi**, chunki kirish matni bir martalik kodni o'z
  ichiga oladi. Worker xatoda `throw` qiladi (BullMQ shundan qayta uradi), lekin
  `settle()` ning o'z xatosi job'ni yiqitmaydi — aks holda yuborilgan SMS ikkinchi
  marta ketardi.
  `JOBS_INLINE=true` — Redis'siz, chaqiruvchi jarayonda; testlar va lokal ishlash
  uchun, handler kodi bir xil. Yo'l-yo'lakay N-12 (e'lon qilinmagan indekslar)
  topildi va tuzatildi. ·
  `common/jobs/*` (yangi, +14 test), `sms.service.ts` (+7 test),
  `files.service.ts` (+spec yangilandi), `driver-auth`/`password` chaqiruvlari,
  `app.module.ts`, `env.validation.ts`, `.env.example`, `schema.prisma`,
  migratsiya `20260818190449_jobs_sms_and_file_status`,
  `test/jobs.e2e-spec.ts` (+7 e2e) · unit 428 → 450, e2e 214 → 221.

- **TASK-4.4 (A-2, M-8, M-9)** · Cron'lar uchun distributed lock va GPS retention.
  `@Cron` ilovani ishlatayotgan **har bir** protsessda otiladi — bitta serverda
  ko'rinmaydi, ikkinchisi qo'shilgan zahoti kechasi arxivlash o'sha qatorlarni
  ikki marta ko'chiradi, orphan tozalash esa har fayl uchun `NoSuchKey` oladi.
  `CronLockService`: Redis'da `SET key token NX PX ttl`. To'rtala cron shu orqali
  o'tadi (`gps-archive`, `refresh-token-purge`, `idempotency-purge`,
  `orphan-file-purge`). **Qulf ish tugagach ataylab bo'shatilmaydi** — soatlari
  bir necha soniyaga farq qiladigan instansiyalarda qaytarilgan qulf darhol
  qayta ilinadi; TTL bilan o'zi tugashi shu farqni qoplaydi. Redis yo'q bo'lsa
  ish **baribir bajariladi**: har bir job idempotent, ya'ni ikki marta ishlash
  arzon, umuman ishlamaslik esa jimgina bajarilmagan tozalash.
  **M-9**: `gps_tracks_archive` kechasi to'ldirilib hech qachon tozalanmasdi —
  endi o'sha job retention gorizontidan o'tganini o'chiradi,
  `GPS_ARCHIVE_RETENTION_DAYS` (standart 730 kun, `0` — o'chirilgan).
  Partitsiyalash rejasi `docs/ARCHITECTURE.md` §6 ga yozildi va **asoslangan
  holda keyinga qoldirildi**: Prisma partitsiyalangan jadvalni ifodalay olmaydi
  (N-12 tuzog'ining jadval miqyosidagi nusxasi), almashtirish downtime talab
  qiladi va uni **haqiqiy ma'lumot hajmisiz** sinab bo'lmaydi. Shart: birinchi
  pilotda `gps_tracks` 10M qatordan oshsa. Yo'l-yo'lakay orphan fayl tozalash
  (M-17) **umuman testsiz** ekani ma'lum bo'ldi — 6 ta test qo'shildi. ·
  `common/jobs/cron-lock.service.ts` (yangi, +8 test), `tracking.service.ts`
  (+6 test), `files.service.ts` (+6 test), `auth.service.ts`,
  `idempotency.cleanup.ts`, `env.validation.ts`, `.env.example`,
  `docs/ARCHITECTURE.md` §6, `test/cron-lock.e2e-spec.ts` (+5 e2e) ·
  unit 450 → 470, e2e 221 → 226.

- **TASK-4.5 (M-7)** · GPS nuqtalarida idempotency. Telefon paketni **server
  tasdiqlagandan keyingina** «yuborildi» deb belgilaydi; oradagi lahzada o'lgan
  telefon uni qayta yuboradi — bu nosozlik emas, offline navbatning oddiy
  ishlashi. `GpsTrack`da nuqtani noyob qiladigan hech narsa yo'q edi: o'sha
  koordinatalar ikki marta tushib, **har bir masofa yig'indisini shishirardi**
  (per-km oyligi bor haydovchida — to'g'ridan-to'g'ri pul) va marshrutni
  takrorlangan nuqtalarda duduqlantirardi.
  `@@unique([companyId, vehicleId, recordedAt])` — bitta mashina bitta lahzada
  bitta joyda. Kalit `company_id` bilan boshlanadi, ya'ni bir firmaning soati
  boshqasiniki bilan to'qnashmaydi. Yozish `createMany({ skipDuplicates: true })`
  bilan: «avval tekshir» tekshiruv va yozuv orasida oyna qoldiradi va **bitta
  telefonning ikkita flush'i** aynan o'sha oynada poyga qiladi. Paketning o'z
  ichidagi takror ham bazaga borishdan oldin yig'ishtiriladi.
  Javob endi `{ accepted, duplicates, dropped }` — to'liq qayta yuborilgan
  paketga to'g'ri javob «yangisi yo'q», «yana N ta nuqta» emas.
  Migratsiya **qo'lda yozildi**: unique'ni qo'shishdan oldin jadvaldagi mavjud
  dublikatlarni o'chirish kerak (`a.id > b.id` bo'yicha), va bir xil ustunlardagi
  oddiy indeks unique bilan **almashtiriladi** — ikkalasini saqlash eng tez
  o'sadigan jadvalda ikkinchi indeksni bekorga qo'llab-quvvatlash bo'lardi.
  **Isbot**: test bazasidan unique indeks olib tashlanganda 6 ta e2e'dan **4 tasi
  qizil** bo'ldi, qaytarilganda yana yashil. ·
  `schema.prisma`, migratsiya `20260818200000_gps_point_idempotency` (qo'lda),
  `tracking.service.ts` (+5 test), `test/gps-idempotency.e2e-spec.ts` (+6 e2e),
  `test/setup-e2e.ts` (`sms_messages` truncate ro'yxatiga),
  `test/jobs.e2e-spec.ts` (har chaqiruvga yangi IP — Redis'dagi per-IP hisoblagich
  butun e2e to'plamiga umumiy) · unit 470 → 475, e2e 226 → 232.

- **TASK-4.6** · Yuklama testi (k6, `load-test/`). Skriptlar: `read-heavy`
  (logist brauzeri — ro'yxat, moliya, jonli xarita) va `write-heavy` (telefonlar —
  GPS paketi va **o'sha paketning takrori**), `seed.mjs` (20k reys, 100k ledger,
  267k GPS nuqta, 203 mashina, 2k login). Natijalar → **`docs/PERFORMANCE.md`**.
  **Topildi (N-13)**: `GET /trips` o'z tartiblashi uchun indekssiz — `Seq Scan` +
  to'liq sort, 13.8 ms / 670 bufer → indeks bilan **0.13 ms / 23 bufer**;
  endpoint darajasida 32.0 → 22.8 ms.
  **O'lchandi**: o'qishda to'yinish ~50 VU / ~110–120 req/s (bitta 4 yadroli
  konteynerda API+baza+generator birga), 200 VU'gacha **xatolik 0%** — to'yinganda
  tizim sekinlashadi, yiqilmaydi. Yozishda 40 telefon: p95 **74 ms**.
  TASK-4.5 idempotency **yuklama ostida** tasdiqlandi: 364 iteratsiya × 10 nuqta =
  aynan **+3 640 qator**, har takroriy paket `accepted: 0, duplicates: 10`.
  **Testning o'zida ikkita xato topildi va tuzatildi** — ular hujjatda ham
  yozilgan, chunki har ikkalasi ham «yashil, lekin ma'nosiz» natija berardi:
  (1) 100 VU bitta login ostida → 97% so'rov 429; rate limiter ilovani emas,
  testni o'lchayotgan edi. Endi har VU o'z logini va o'z IP'si bilan;
  (2) har VU boshqa haydovchining reysiga post qilardi — bu 200 bilan javob
  beriladi va **hamma nuqta jimgina tashlanadi**; tekshiruv faqat 2xx'ga
  qaraganidan test yashil bo'lib, bazaga **hech narsa yozmasdi**. Endi tekshiruv
  `accepted === 10` ni talab qiladi.
  **Tekshirilmadi**: 10 000 foydalanuvchi — bu muhitda o'lchash mantiqsiz
  (sabab `docs/PERFORMANCE.md` §6 da), o'rniga stateless arxitektura va
  kengaytirish sharti yozildi. Ulanish puli bo'yicha ko'rsatma
  `docs/DEPLOYMENT.md` §10 ga qo'shildi. ·
  `load-test/**` (yangi), `schema.prisma`, migratsiya
  `20260818210000_trip_list_index`, `docs/PERFORMANCE.md` (yangi),
  `docs/DEPLOYMENT.md` §10, `eslint.config.mjs` (k6/Node global'lari) ·
  unit 475 (o'zgarmadi — bu o'lchov taski), e2e 232.

- **TASK-5.1 (M-13)** · Rol-asosidagi router va navigatsiya. `ProtectedRoute`
  faqat «kimdir kirganmi» deb so'rardi: web'ga kirgan HAYDOVCHI menyudagi hamma
  sahifani ko'rib, har birida API'dan 403 olardi — qorovul haqiqiy, interfeys
  esa yolg'on gapirardi.
  `app/routes.ts` — **yagona jadval**, router ham yon menyu ham o'shani o'qiydi
  (menyu taklif qiladigan, router rad etadigan sahifa — o'sha xatoning
  chiroyliroq ko'rinishi). Rollar controller'lardagi `@Roles` bilan aynan mos
  va testlar shu juftlikni qotirib qo'yadi.
  Uch qaror: (1) rol **`/auth/me` dan**, `localStorage`dan emas — foydalanuvchi
  o'zgartira oladigan rol qorovul emas; (2) ruxsat yo'q bo'lsa **403 sahifasi**,
  boshqa sahifaga jimgina yo'naltirish emas — bunday otib yuborish «menda
  nimadir buzuq» degan taassurot beradi; (3) `/` endi qat'iy `/trips` emas,
  balki **shu rol ocha oladigan birinchi** sahifa — haydovchi uchun eski holat
  butun ilovaning kirish ekranini 403 qilardi.
  Haydovchi uchun yon menyu butunlay bo'sh — bu to'g'ri javob.
  Matnlar uchta tilda. **Isbot**: qorovul olib tashlanganda 2 ta test qizil. ·
  `app/routes.ts` (+23 test), `app/ProtectedRoute.tsx` (+6 test),
  `app/ForbiddenPage.tsx`, `app/HomeRedirect.tsx`, `app/App.tsx`,
  `app/AppLayout.tsx`, uchta `locales/*.json` · web testlari 22 → 51.

- **TASK-5.2 (M-14)** · Pul o'zgarishlarida xavfsiz UX. Audit yozgan
  «`<Select>` bilan to'lov statusi» qismi **TASK-3.1 da allaqachon** yopilgan
  (status ledger'dan hisoblanadi, ekranda faqat `Badge`); qolgani shu yerda.
  **Tasdiqlash oynasi**: xarajatni tasdiqlash bitta bosishda, hech narsa
  ko'rsatmasdan bo'lardi. Endi oyna **summa va kategoriyani takrorlaydi** —
  faqat «ishonchingiz komilmi?» deydigan oyna odamlar o'qimasdan yopishni
  o'rganadigan oyna.
  **Bekor qilish oqimi**: `POST /expenses/:id/reverse` TASK-3.12 dan beri bor
  edi, lekin **interfeysda uni chaqiradigan hech narsa yo'q edi** — ya'ni
  tasdiqlangan xarajatni tuzatish yo'li amalda yo'q edi. Endi OWNER/ACCOUNTANT
  uchun tugma bor va u **sababni majburiy** so'raydi.
  **Ikki marta bosish**: tugma so'rov ketayotganda o'chiriladi va `onConfirm`
  ichida ham qorovul bor (tez ikki bosish React qayta chizishga ulgurmasidan
  ikkinchi submit yuborishi mumkin); ustiga `Idempotency-Key` (TASK-3.2).
  **`MoneyInput`**: raqamlar yozilayotganda guruhlanadi (`1 000 000`) va «so'm»
  yozuvi turadi — `1000000` va `10000000` bir belgiga, pulda esa o'n million
  so'mga farq qiladi. `type="number"` ataylab ishlatilmaydi: u `1e9` ni jimgina
  qabul qiladi va spinner'i sichqoncha g'ildiragi bilan pulni o'zgartirish
  yo'lini ochadi. Barcha pul formalarida ishlatildi (xarajat, kirim, reys
  narxi va avansi, haydovchi oyligi). Matnlar uchta tilda. ·
  `shared/ui/ConfirmDialog.tsx` (+8 test), `shared/ui/MoneyInput.tsx` (+8 test),
  `FinancePage.tsx`, `TripForm.tsx`, `DriversPage.tsx`, `shared/api/crud.ts`
  (`post` endi `body` oladi), `shared/api/entities.ts` (`reversalOfId`),
  uchta `locales/*.json` · web testlari 51 → 67.

- **TASK-5.3** · Forma validatsiyasi va xato holatlari. `ValidationPipe` javobni
  tekis `string[]` qilib yuboradi, har satr o'z maydoni nomi bilan boshlanadi;
  bu bitta abzats bo'lib chiqardi va foydalanuvchi **qaysi katak noto'g'ri
  ekanini o'zi qidirardi**. `fieldErrors()` uni ajratadi, xabar o'sha maydon
  tagida chiqadi. Ajratish ataylab ehtiyotkor — birinchi so'zi ishonchli maydon
  nomiga o'xshamasa, xabar forma darajasida qoladi: **noto'g'ri maydon tagidagi
  xabar yuqoridagisidan yomonroq**.
  `validate.ts` — backend DTO'larini takrorlaydigan klient tekshiruvlari
  (qoida emas, xushmuomalalik: server baribir hal qiladi). Asosiy shart —
  **klient serverdan qattiqroq bo'lmasligi**. Shuni tekshirib ko'rish
  **N-14 ni topdi**: `IsTiyin` nolni qabul qilardi; `IsPositiveTiyin` qo'shildi.
  `useFormErrors` — lokal va server xatolarini birlashtiradi (lokal ustun,
  chunki u ekrandagi qiymatdan chiqqan; server esa yuborilganini tasvirlaydi).
  Skelet yuklagichlar: jadval va xarita uchun o'z shaklidagi bloklar — spinner
  qatorlar kelganda sahifani sakratadi. ·
  `shared/api/field-errors.ts` (+7 test), `shared/utils/validate.ts` (+17 test),
  `shared/api/useFormErrors.ts`, `shared/ui/index.tsx` (`Field` `error` propi,
  `ErrorMessage` `only` propi, `TableSkeleton`, `MapSkeleton`),
  `FinancePage.tsx`, `TripForm.tsx`, 4 ta sahifada skelet,
  `common/dto/money.ts` + `money.spec.ts` (+9 test), `expense.dto.ts`,
  `trip.dto.ts`, uchta `locales/*.json` · unit 475 → 485, web 67 → 91.

- **TASK-5.4 (H-14, M-10, M-11)** · Mobil UX va barqarorlik.
  **H-14 — foto yo'qolishi**: `_uploadPhoto` `null` qaytarganda hodisa
  **fotosiz** yuborilardi, server qabul qilardi va qator `synced=1` bo'lardi —
  ya'ni chek yoki yetkazib berish fotosi **boshqa hech qachon yuborilmasdi**.
  Endi fayl hali diskda bo'lsa hodisa navbatda qoladi; fayl o'chib ketgan
  bo'lsa (kutish yordam bermaydi) fotosiz ketadi — bitta yo'qolgan foto butun
  navbatni abadiy to'smasligi kerak. Yo'lakay: hamma hodisa ushlab qolinsa
  **bo'sh so'rov yuborilmaydi** (haydovchi trafigi).
  Yuklash `ApiClient.upload()` ga o'tdi: ilgari o'z `MultipartRequest`i
  `accessToken` ni to'g'ridan-to'g'ri olardi (**refresh yo'q** — muddati o'tgan
  token shunchaki «yuklanmadi» edi) va `id` ni **regex bilan** sug'urardi
  (konvert ozgina o'zgarsa — jimgina `null`). Endi o'sha konvert, o'sha
  refresh, va `jsonDecode` bilan `data.id`.
  **M-11 — GPS ruxsati**: `start()` faqat `true/false` qaytarardi va chaqiruvchi
  uni e'tiborsiz qoldirardi — bir marta «rad etish» bosgan haydovchi **treksiz
  reys** oladi va ekranda hech narsa yo'q. `GpsBlock` uch holatni ajratadi
  (`serviceOff` / `denied` / `deniedForever`) va banner mos tugma beradi:
  tizim sozlamalari, qayta so'rash, yoki ilova sozlamalari — noto'g'ri sahifaga
  yuborish boshi berk ko'cha.
  **M-10** (`purgeSynced`, `onUpgrade`) — TASK-1.2 da bajarilgan, tekshirildi.
  **Isbot**: qorovul olib tashlanganda foto testi qizil. ·
  `core/api/api_client.dart` (`upload()`), `core/sync/offline_queue.dart`,
  `core/gps/gps_service.dart` (`GpsBlock`),
  `features/home/gps_permission_banner.dart` (yangi), `features/home/home_screen.dart`,
  `core/i18n/app_strings.dart` (uchta til), `test/offline_queue_test.dart` (+5) ·
  Flutter testlari 23 → 28, `flutter analyze` toza.

- **TASK-5.5 (L-10)** · Accessibility va sayqal.
  **Kontrast — ko'z bilan emas, o'lchov bilan**: brend palitrasi qorong'i
  interfeys uchun qurilgan va o'sha yerda a'lo (navy fonda accent 7.0:1), oq
  fonda esa **2.03:1** — AA ning oddiy matn uchun 4.5 sidan ham, katta matn
  uchun 3.0 sidan ham past. Qoraytirilgan `-text` variantlari qo'shildi
  (accent 4.58, success 4.50, danger 4.52, muted 4.51) va yorug' rejimdagi
  **62 ta matn joyi** `text-X-text dark:text-X` ga o'tkazildi; brend ranglari
  fon uchun qoldi. Palitra **bitta JSON faylda** — `tailwind.config.js` ham,
  kontrast testi ham o'shani o'qiydi, ya'ni palitrani o'zgartirish testni
  jimgina o'tkazib yubormaydi. `danger` navy fonda 3.60:1 — katta matn
  chegarasi, testda **ataylab yozib qo'yilgan**.
  **Modal**: ilgari sahifa ustidagi oddiy `div` — Tab undan chiqib ketardi
  (foydalanuvchi orqadagi ko'rinmayotgan formaga yozishi mumkin edi), skrinrider
  hech narsa aytmasdi, yopilganda fokus hujjat boshiga tushardi. Endi
  `role="dialog"` + `aria-modal` + `aria-labelledby`, Tab ichida aylanadi, Esc
  yopadi, fokus **ochgan elementga** qaytadi.
  **Jadval/tugmalar**: `<th scope="col">`, tab-tugmalarda `aria-pressed`
  (joriy tab aks holda faqat rang), `focus-visible` uchun `outline` — qorong'i
  fonda kursor yo'qolmasligi uchun.
  **Xarita — matnli muqobil**: xarita rasm, rasm esa skrinriderga o'qilmaydi.
  «Xarita / Ro'yxat» almashtirgichi qo'shildi; ro'yxat o'sha ma'lumotni jadval
  qilib beradi va «hozir qaysi mashinalar to'xtagan?» degan savolga ko'pincha
  tezroq javob beradi.
  **Isbot**: fokus tuzog'i olib tashlanganda 3 ta test qizil. ·
  `shared/ui/palette.json` (yangi), `tailwind.config.js`,
  `shared/ui/index.tsx` (Modal, Table, Button, Input),
  `shared/ui/contrast.test.ts` (+11), `shared/ui/Modal.test.tsx` (+9),
  `MapPage.tsx` (ro'yxat ko'rinishi), `FinancePage.tsx`, 15 ta faylda rang
  tokenlari, uchta `locales/*.json` · web testlari 91 → 111.

**PHASE 3 tugadi (12/12).**

**PHASE 4 tugadi (6/6).**

**PHASE 5 tugadi (5/5).**

**Keyingi qadam:** yakuniy hisobot — `docs/FIX-REPORT.md`, ROADMAP/ARCHITECTURE/
CLAUDE.md yangilash, va N-8 (repo bo'ylab bir martalik `pnpm format`).

PHASE 3 qolgan bog'liqliklar:

- TASK-3.3 (valyuta): ledger'da `amountBase`/`rateUsed`/`rateDate` maydonlari **allaqachon bor**
  va hozircha `amountBase = amount` (hammasi UZS deb faraz). 3.3 faqat konvertatsiyani
  to'ldiradi — migratsiya qayta yozilmaydi.
- TASK-3.4 (yangi status'lar) `packages/shared` enum'ini va web `StatusBadge`ni ham talab qiladi
  (API kontrakti).
