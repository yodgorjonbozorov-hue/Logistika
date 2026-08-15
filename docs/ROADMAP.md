# TruckControl AI — Yo'l xaritasi (9 bosqich)

> Har seans oxirida bajarilgan punktlar `[x]` bilan belgilanadi.
> Bosqich tugadi = barcha punktlari belgilangan + testlari yashil.
>
> TZ §10 dagi 4 ishlab chiqish bosqichiga moslik: bizning 2–8-bosqichlar ≈ TZ «Bosqich 1 (MVP)»
>
> - «Bosqich 2»; 9-bosqich ≈ TZ «Bosqich 3»; TZ «Bosqich 4» (AI-5/6/7, treker/OBD, 1C, birja) —
>   pilotdan keyin, bu faylga kirmagan.

## 1-bosqich — Poydevor ✅

- [x] `docs/TZ.md` — rasmiy TZ v1.0 joylashtirildi
- [x] `docs/ARCHITECTURE.md` — arxitektura va qarorlar (TZ v1.0 ga moslangan)
- [x] `CLAUDE.md` — ish qoidalari
- [x] `docs/ROADMAP.md` — ushbu reja
- [x] Monorepo skeleti: pnpm workspaces, tsconfig, eslint, prettier
- [x] `docker-compose.yml` (postgres, redis, minio) + `.env.example`
- [x] `README.md`

## 2-bosqich — Backend asosi ✅

- [x] NestJS ilova skeleti (`apps/backend`), config moduli (env validatsiyasi)
- [x] Prisma sxemasi — TZ §5 jadvallari: companies, users, drivers, vehicles, clients,
      trips, trip_events, expenses, fuel_logs, incomes, gps_tracks, maintenance,
      documents, notifications (pul BigInt tiyin, vaqt UTC, snake_case)
- [x] Prisma Client Extension: majburiy `company_id` filtri (`forCompany()`)
- [x] Global API-javob interceptor `{ success, data, error, meta }` + exception filter (`AppException`)
- [x] `auth`: email/parol login, JWT access+refresh (rotatsiya), RBAC guard'lari
      (OWNER/LOGIST/ACCOUNTANT/DRIVER)
- [x] `audit` moduli: o'zgarishlar logi (kim, qachon, nimani)
- [x] Backend i18n asosi (xato kodlari, uz-latn/uz-cyrl/ru)
- [x] Testlar: auth oqimi, tenant-izolyatsiya (unit — extension + sxema-qamrov),
      javob formati; real bazali e2e izolyatsiya testlari 3-bosqichdan modul-boshiga yoziladi

## 3-bosqich — Asosiy CRUD ✅

- [x] `companies` (sozlamalar, obuna maydonlari) + superadmin `/admin/companies`
- [x] `users` CRUD; haydovchi auth (telefon + SMS-kod, 5 daq TTL, 5 urinish, enumeratsiyasiz)
- [x] `drivers`: profil, ish haqi turi (fixed/percent/per_km), soft-delete
- [x] `clients`: mijozlar, to'lov shartlari, balans
- [x] `vehicles`: kartochka, norma l/100km, probeg, hujjat muddatlari
- [x] `trips`: hayot sikli (draft→assigned→in_progress→completed/cancelled), avans, spidometr,
      kompaniya-boshiga raqamlash, tenant-ichida referens tekshiruvi
- [x] `expenses`/`incomes`: kategoriyalar, tasdiqlash (approve'dan keyin o'zgartirib bo'lmaydi),
      to'lov holatlari
- [x] `files`: MinIO yuklash, foto siqish (max 1500px, EXIF-rotatsiya), imzolangan URL,
      tenant-prefiks kalitlar
- [x] Har modulga unit-test izolyatsiya stsenariysi bilan (60 test); real bazali e2e — 9-bosqich
      xavfsizlik auditida

## 4-bosqich — Web asos + logist paneli ✅

- [x] Vite + Tailwind + TanStack Query skelet, i18n (uz-latn/uz-cyrl/ru, default uz-latn),
      qorong'i rejim (default), brend palitra (TZ §11)
- [x] Auth sahifasi, himoyalangan router, API-klient (`shared` tiplari, envelope-unwrap,
      avtomatik refresh-rotatsiya)
- [x] W-3 Reyslar: ro'yxat + status filtr + pagination, yangi reys formasi (mijoz, yuk,
      marshrut, narx/avans so'mda → tiyin BigInt)
- [x] W-4 Reys kartochkasi: xronologiya / moliya / hujjatlar tablari + hayot sikli amallari
      (biriktirish, boshlash, yakunlash, bekor qilish); haydovchi hodisalari va hujjatlar
      tablari 5/7-bosqichda to'ldiriladi
- [x] W-5 Avtopark, W-6 Haydovchilar sahifalari (CRUD + deaktivatsiya)
- [x] Mijozlar sahifasi, xarajat/kirim formalari, tasdiqlash tugmasi (buxgalter oqimi)

## 5-bosqich — Haydovchi mobil ilovasi (MVP) ✅

- [x] Flutter skelet, i18n (3 til, kalit-qamrov testi bilan), qorong'i rejim,
      katta tugmalar (TZ §3.1)
- [x] E-1 Kirish: telefon+SMS kod
- [x] E-2/E-3: 10 ta status tugmasi — har bosishda vaqt (UTC) + GPS + kerakli foto
      (spidometr, litr/summa maydonlari turiga qarab)
- [x] Offline navbat (sqflite) + idempotent `POST /events/batch` sinxron (klient UUID,
      connectivity'da avto-retry, foto avval /files/upload) — testlar bilan
- [x] Backend: `events` (idempotent batch, testlar), `tracking` qabul, `GET /trips/my`
- [x] E-2 reys kartasi, E-5 Xarajatlarim (sinxron holati bilan), E-6 placeholder
      (documents moduli 7-bosqichda), E-7 Profil (til, sinxron hisoblagich, chiqish)
- [x] Fon rejimida GPS: 3 daqiqalik batch, geolocator foreground-service
      (Android'da ilova yig'ilganda ham); to'liq «ilova o'ldirilgan» rejim sinovi —
      9-bosqich qurilma-testlarida

## 6-bosqich — Xarita va kuzatuv ✅

- [x] Backend `tracking`: jonli holat (oxirgi hodisa + oxirgi GPS nuqta), trek tarixi,
      marshrutdan chetlash (yuklash→tushirish koridoridan km, geo-testlar bilan)
- [x] W-2 jonli xarita (Leaflet): holat ranglari (🟢🟡🔴⚪️) + hisoblagichli legenda,
      mashina kartochkasi (haydovchi, reys, tezlik, chetlash, oxirgi signal), 30s polling
- [x] Marshrut tarixi (mashina + sana tanlab polyline chizish)
- [x] Mashina holatlari hodisalardan avtomatik (BREAKDOWN/REST/RESUME/DELIVERED… — testlar bilan)
- [x] `gps_tracks` arxivlash: tungi cron 90 kundan eski nuqtalarni `gps_tracks_archive`ga ko'chiradi
- [x] Mijoz tracking-havolasi: `POST /trips/:id/share-link` (muddatli token) +
      autentifikatsiyasiz `/track/:token` sahifasi — sanitizatsiya testda tekshirilgan (TZ §4.2)

## 7-bosqich — Moliya yadrosi ✅

- [x] `finance`: TZ §6 formulalari — reys foydasi, amortizatsiya, 1 km tannarxi, ROI
      (faqat deterministik kod, BigInt; nisbatlar bazis punktda)
- [x] `fuel`: jurnal, norma-taqqoslash, W-8 nazorat jadvali, AZS tahlili,
      chegara oshsa signal (default 7%, `ai_settings.fuel_deviation_threshold_bp`)
- [x] `maintenance`: TO tarixi, keyingi TO rejasi (≤1000 km qolganda «due»)
- [x] `documents`: muddat eslatmalari 15/7/1 kun — kunlik cron (`@nestjs/schedule`;
      BullMQ AI navbati uchun qoldirildi), mashina/haydovchi kartochkasidagi muddatlar ham
- [x] `alerts`: ogohlantirishlar markazi (W-10), matn bazada i18n kalit + parametr sifatida
- [x] `reports`: W-1 dashboard, W-9 hisobotlar (reys/mashina/yo'nalish/haydovchi/mijoz,
      xarajat strukturasi), eksport — server `xlsx`/`csv`, PDF brauzer print oynasi orqali
- [x] Web: W-1 dashboard, W-7 moliya (umumiy + qarzdorlar), W-8 yoqilg'i, W-9 hisobotlar,
      W-10 ogohlantirishlar; W-4 moliya tabi endi real P&L'dan
- [x] Moliya testlari: chegara holatlari, yaxlitlash, BigInt (eng yuqori qamrov)

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

- [x] Web panel moslashuvchan: telefon/planshetda drawer menyu, jadvallar kartochka
      ko'rinishida, forma va xarita qayta joylashadi (i18n kalitlari yechilishi ham tuzatildi)
- [x] `apps/landing` — ommaviy sayt: muammo, imkoniyatlar, AI, natija, tariflar (TZ §12.1),
      demo CTA; uz-latn/uz-cyrl/ru, bog'lanish kanallari env orqali
- [ ] `chat`: logist ↔ haydovchi (matn + foto + ovozli xabar)
- [ ] Haydovchi reytingi (kechikish, yoqilg'i farqi, nosozlik) — E-7 va W-6
- [ ] i18n to'liq: uz-cyrl va ru tarjimalari (web, mobil, backend xabarlari)
- [ ] Marshrutdan chetlash va «2+ soat qimirlamadi» ogohlantirishlari jonli
- [ ] Production Docker Compose (backend, web, nginx, backup cron), HTTPS
- [ ] Kunlik zaxira nusxa + tiklash tekshiruvi
- [ ] Xavfsizlik auditi: tenant-izolyatsiya, RBAC, audit-log, shifrlangan saqlash (TZ §9)
- [x] Panel demo rejimi (`pnpm --filter web build:demo`) — backendsiz, fixture ma'lumot bilan
      (bazaga yoziladigan seed hali qilinmadi)
- [ ] Seed/demo ma'lumotlar, pilot firma onboarding qo'llanmasi (TZ §12.2 — 2 firma, 2 oy bepul)
- [ ] E2E smoke: reys ochish → haydovchi 10 tugma → xaritada ko'rinadi → chek foto → AI-2 →
      tasdiqlash → reys P&L → dashboard

## Pilotdan keyin (TZ §10 Bosqich 4 — bu rejaga kirmaydi)

AI-5 narx maslahatchisi, AI-6 ETA bashorati, AI-7 nosozlik tashxisi (3–6 oylik real ma'lumot
to'plangach); GPS-treker/OBD-II va yoqilg'i datchigi integratsiyasi; 1C integratsiya; yuk birjasi.
