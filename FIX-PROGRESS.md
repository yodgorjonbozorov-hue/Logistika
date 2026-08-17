# FIX PROGRESS

Boshlangan: 2026-08-17

## Holat

- [x] PHASE 0 — Baseline
- [x] PHASE 1 — Blockers (8 ta task)
- [ ] PHASE 2 — Security (9 ta task)
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

PHASE 2 → TASK-2.4 (refresh token: rotation race, reuse detection, client single-flight).
