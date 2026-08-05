# TruckControl AI — Yo'l xaritasi (9 bosqich)

> Har seans oxirida bajarilgan punktlar `[x]` bilan belgilanadi.
> Bosqich tugadi = barcha punktlari belgilangan + testlari yashil.
>
> TZ §10 dagi 4 ishlab chiqish bosqichiga moslik: bizning 2–8-bosqichlar ≈ TZ «Bosqich 1 (MVP)»
> + «Bosqich 2»; 9-bosqich ≈ TZ «Bosqich 3»; TZ «Bosqich 4» (AI-5/6/7, treker/OBD, 1C, birja) —
> pilotdan keyin, bu faylga kirmagan.

## 1-bosqich — Poydevor ✅

- [x] `docs/TZ.md` — rasmiy TZ v1.0 joylashtirildi
- [x] `docs/ARCHITECTURE.md` — arxitektura va qarorlar (TZ v1.0 ga moslangan)
- [x] `CLAUDE.md` — ish qoidalari
- [x] `docs/ROADMAP.md` — ushbu reja
- [x] Monorepo skeleti: pnpm workspaces, tsconfig, eslint, prettier
- [x] `docker-compose.yml` (postgres, redis, minio) + `.env.example`
- [x] `README.md`

## 2-bosqich — Backend asosi

- [ ] NestJS ilova skeleti (`apps/backend`), config moduli (env validatsiyasi)
- [ ] Prisma sxemasi — TZ §5 jadvallari: companies, users, drivers, vehicles, clients,
      trips, trip_events, expenses, fuel_logs, incomes, gps_tracks, maintenance,
      documents, notifications (pul BigInt tiyin, vaqt UTC, snake_case)
- [ ] Prisma Client Extension: majburiy `company_id` filtri
- [ ] Global API-javob interceptor `{ success, data, error, meta }` + exception filter (`AppException`)
- [ ] `auth`: email/parol login, JWT access+refresh, RBAC guard'lari (OWNER/LOGIST/ACCOUNTANT/DRIVER)
- [ ] `audit` moduli: o'zgarishlar logi (kim, qachon, nimani)
- [ ] Backend i18n asosi (xato kodlari, uz-latn/uz-cyrl/ru)
- [ ] Testlar: auth oqimi, tenant-izolyatsiya, javob formati

## 3-bosqich — Asosiy CRUD

- [ ] `companies` (sozlamalar, obuna maydonlari) + superadmin `/admin/companies`
- [ ] `users` CRUD; haydovchi auth (telefon + SMS-kod / login-parol)
- [ ] `drivers`: profil, ish haqi turi (fixed/percent/per_km), hujjatlar
- [ ] `clients`: mijozlar, to'lov shartlari, balans
- [ ] `vehicles`: kartochka, norma l/100km, probeg, hujjat muddatlari
- [ ] `trips`: hayot sikli (draft→assigned→in_progress→completed/cancelled), avans, spidometr
- [ ] `expenses`/`incomes`: kategoriyalar, tasdiqlash, to'lov holatlari
- [ ] `files`: MinIO yuklash, foto siqish (max 1500px), imzolangan URL, tenant-prefiks
- [ ] Har modulga test (izolyatsiya stsenariysi bilan)

## 4-bosqich — Web asos + logist paneli

- [ ] Vite + Tailwind + TanStack Query skelet, i18n (uz-latn default), qorong'i rejim
- [ ] Auth sahifalari, himoyalangan router, API-klient (`packages/shared` tiplari bilan)
- [ ] W-3 Reyslar: ro'yxat + filtr, yangi reys formasi (mijoz, yuk, marshrut, avans)
- [ ] W-4 Reys kartochkasi: xronologiya / moliya / hujjatlar tablari
- [ ] W-5 Avtopark, W-6 Haydovchilar sahifalari
- [ ] Mijozlar sahifasi, xarajat/kirim formalari (buxgalter oqimi)

## 5-bosqich — Haydovchi mobil ilovasi (MVP)

- [ ] Flutter skelet, i18n (3 til), qorong'i rejim, katta tugmalar (TZ §3.1)
- [ ] E-1 Kirish: telefon+SMS yoki login/parol
- [ ] E-2/E-3: 10 ta status tugmasi — har bosishda vaqt (UTC) + GPS + kerakli foto
- [ ] Offline navbat (drift/sqlite) + idempotent `POST /events/batch` sinxron
- [ ] E-4 Reys tafsiloti (avans, yetkazish vaqti), E-5 Xarajatlarim, E-6 Hujjatlarim, E-7 Profil
- [ ] Fon rejimida GPS: 2–5 daqiqa, paketli, ilova yopiq bo'lsa ham (TZ §3.3)

## 6-bosqich — Xarita va kuzatuv

- [ ] Backend `tracking`: paket qabul, jonli holat, trek tarixi, marshrutdan chetlash
- [ ] W-2 jonli xarita (Leaflet): holat ranglari (🟢🟡🔴⚪️), mashina kartochkasi
- [ ] Marshrut tarixi (sana tanlab chizish)
- [ ] Mashina holatlari hodisalardan avtomatik
- [ ] `gps_tracks` arxivlash strategiyasi (90 kun)
- [ ] Mijoz tracking-havolasi (`public-link`): yaratish + autentifikatsiyasiz sahifa (TZ §4.2)

## 7-bosqich — Moliya yadrosi

- [ ] `finance`: TZ §6 formulalari — reys foydasi, amortizatsiya, 1 km tannarxi, ROI
      (faqat deterministik kod, BigInt)
- [ ] `fuel`: jurnal, norma-taqqoslash, W-8 nazorat jadvali, AZS tahlili,
      chegara oshsa signal (default 7%, `ai_settings.fuel_deviation_threshold`)
- [ ] `maintenance`: TO tarixi, keyingi TO rejasi
- [ ] `documents`: muddat eslatmalari 15/7/1 kun (BullMQ cron)
- [ ] `alerts`: ogohlantirishlar markazi (W-10 ro'yxati)
- [ ] `reports`: W-1 dashboard, W-9 hisobotlar (reys/mashina/yo'nalish/haydovchi/mijoz,
      xarajat strukturasi), Excel/PDF eksport
- [ ] Web: W-1 dashboard, W-7 moliya, W-8 yoqilg'i, W-9 hisobotlar, W-10 ogohlantirishlar
- [ ] Moliya testlari: chegara holatlari, yaxlitlash, BigInt (eng yuqori qamrov)

## 8-bosqich — AI funksiyalari (TZ §8)

- [ ] `ai` moduli asosi: Claude klienti (Haiku/Sonnet tanlash, timeout, retry),
      `ai_requests`/`ai_insights`/`ai_settings` jadvallari, xarajat-log va oylik limit
- [ ] **AI-2 chek/hujjat OCR** (TZ MVP funksiyasi): foto → JSON taklif → avto-tekshiruvlar
      (summa=litr×narx, sana, GPS-joy, takroriy chek hash) → tasdiqlash/tuzatish oqimi
- [ ] **AI-1 ovozli kiritish**: Whisper → strukturalash, confidence < 0.7 → qayta so'rash,
      ovoz fayli 30 kun saqlanadi
- [ ] **AI-4 anomaliya detektori**: statistika kodda, izoh/tavsiya AI'da; `ai_insights`
      holatlari (false_positive bilan)
- [ ] **AI-3 AI-boshliq**: 2 bosqichli function calling (whitelist: get_vehicle_profit,
      get_driver_stats, get_fuel_anomalies, get_route_profitability, get_receivables,
      compare_periods), web + Telegram
- [ ] **AI-8 kunlik xulosa**: har kuni 20:00 Telegramga (BullMQ cron)
- [ ] Telegram bot ulash + FCM push
- [ ] AI chegaralari testlari: bazaga yozmasligi, SQL yo'qligi, taklif-tasdiqlash oqimi, limit

## 9-bosqich — Sayqal va pilot

- [ ] `chat`: logist ↔ haydovchi (matn + foto + ovozli xabar)
- [ ] Haydovchi reytingi (kechikish, yoqilg'i farqi, nosozlik) — E-7 va W-6
- [ ] i18n to'liq: uz-cyrl va ru tarjimalari (web, mobil, backend xabarlari)
- [ ] Marshrutdan chetlash va «2+ soat qimirlamadi» ogohlantirishlari jonli
- [ ] Production Docker Compose (backend, web, nginx, backup cron), HTTPS
- [ ] Kunlik zaxira nusxa + tiklash tekshiruvi
- [ ] Xavfsizlik auditi: tenant-izolyatsiya, RBAC, audit-log, shifrlangan saqlash (TZ §9)
- [ ] Seed/demo ma'lumotlar, pilot firma onboarding qo'llanmasi (TZ §12.2 — 2 firma, 2 oy bepul)
- [ ] E2E smoke: reys ochish → haydovchi 10 tugma → xaritada ko'rinadi → chek foto → AI-2 →
      tasdiqlash → reys P&L → dashboard

## Pilotdan keyin (TZ §10 Bosqich 4 — bu rejaga kirmaydi)

AI-5 narx maslahatchisi, AI-6 ETA bashorati, AI-7 nosozlik tashxisi (3–6 oylik real ma'lumot
to'plangach); GPS-treker/OBD-II va yoqilg'i datchigi integratsiyasi; 1C integratsiya; yuk birjasi.
