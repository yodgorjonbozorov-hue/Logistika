# TruckControl AI — Yo'l xaritasi (9 bosqich)

> Har seans oxirida bajarilgan punktlar `[x]` bilan belgilanadi.
> Bosqich tugadi = barcha punktlari belgilangan + testlari yashil.

## 1-bosqich — Poydevor (hozirgi)

- [x] `docs/TZ.md` — texnik topshiriq (prezentatsiyadan tuzildi, ega tasdig'i kutilmoqda)
- [x] `docs/ARCHITECTURE.md` — arxitektura va qarorlar
- [x] `CLAUDE.md` — ish qoidalari
- [x] `docs/ROADMAP.md` — ushbu reja
- [x] Monorepo skeleti: pnpm workspaces, tsconfig, eslint, prettier
- [x] `docker-compose.yml` (postgres, redis, minio) + `.env.example`
- [x] `README.md`
- [ ] TZ.md loyiha egasi tomonidan tasdiqlanishi

## 2-bosqich — Backend asosi

- [ ] NestJS ilova skeleti (`apps/backend`), config moduli (env validatsiyasi)
- [ ] Prisma ulanishi + boshlang'ich sxema: Company, User, Vehicle (pul BigInt tiyin, vaqt UTC)
- [ ] Prisma Client Extension: majburiy `company_id` filtri
- [ ] Global API-javob interceptor `{ success, data, error, meta }` + exception filter
- [ ] `auth` moduli: email/parol login, JWT access+refresh, rol guard'lari
- [ ] Backend i18n asosi (xato kodlari, uz-latn/ru/uz-cyrl)
- [ ] Testlar: auth oqimi, tenant-izolyatsiya, javob formati

## 3-bosqich — Asosiy CRUD

- [ ] `companies` (sozlamalar: vaqt mintaqasi, yoqilg'i chegarasi) va `users` CRUD
- [ ] `vehicles` CRUD (holatlar, norma l/100km)
- [ ] `trips` hayot sikli: ochish, biriktirish, yopish
- [ ] `expenses`/`incomes` CRUD, to'lov holatlari
- [ ] `files` moduli: MinIO yuklash, imzolangan URL, tenant-prefiks
- [ ] Haydovchi auth (telefon + kod/PIN)
- [ ] Har modulga test (izolyatsiya stsenariysi bilan)

## 4-bosqich — Web asos + logist paneli

- [ ] Vite + Tailwind + TanStack Query skelet, i18n (uz-latn default)
- [ ] Auth sahifalari, himoyalangan router, API-klient (`packages/shared` tiplari bilan)
- [ ] Texnika va foydalanuvchilar sahifalari
- [ ] Reys ochish/boshqarish oqimi
- [ ] Xarajat/kirim kiritish formalari

## 5-bosqich — Haydovchi mobil ilovasi (MVP)

- [ ] Flutter skelet (`mobile/truckcontrol_driver`), i18n
- [ ] Telefon+kod bilan kirish
- [ ] 8 hodisa tugmasi (vaqt + GPS + foto avtomatik)
- [ ] Offline navbat (drift/sqlite) + idempotent `POST /events/batch` sinxron
- [ ] Chek/hujjat foto yuborish oqimi
- [ ] `tracking`: fon rejimida GPS yuborish

## 6-bosqich — Xarita va kuzatuv

- [ ] Backend: `tracking` qabul/saqlash, jonli holat, trek tarixi API
- [ ] Web jonli xarita (Leaflet): mashinalar, holat ranglari, kartochka
- [ ] Marshrut tarixi ko'rinishi
- [ ] Mijoz havolasi (`public-link`): yaratish + autentifikatsiyasiz sahifa
- [ ] Mashina holatlari avtomatik (hodisalardan)

## 7-bosqich — Moliya yadrosi

- [ ] `fuel` moduli: quyishlar, norma-taqqoslash, chetlashish hisobi
- [ ] `finance`: reys P&L, mashina rentabelligi (TZ 6-bo'lim, faqat deterministik kod)
- [ ] `documents`: hujjat meta, muddat eslatmalari (BullMQ cron)
- [ ] `reports`: dashboard agregatlar, davr hisobotlari, whitelist hisobot funksiyalari
- [ ] Web: boshliq dashboard'i (foyda, grafik, rentabellik jadvali)
- [ ] Moliya testlari: chegara holatlari, yaxlitlash, BigInt

## 8-bosqich — AI funksiyalari

- [ ] `ai` moduli: Claude klienti (Haiku/Sonnet tanlash, timeout, retry, narx-log)
- [ ] Chek/hujjat OCR: foto → strukturalangan taklif → tasdiqlash oqimi (draft, odam tasdig'i)
- [ ] AI-chat: tool-use faqat `reports` whitelist funksiyalari orqali (web'da)
- [ ] Anomaliya detektsiyasi: statistika kodda, izoh AI'da; ogohlantirishlar
- [ ] Telegram bot: ulash, chat, kunlik 20:00 xulosa, ogohlantirishlar
- [ ] Whisper: ovoz → matn
- [ ] AI chegaralari testlari (bazaga yozmasligi, SQL yo'qligi, draft oqimi)

## 9-bosqich — Sayqal va pilot

- [ ] i18n to'liq: ru va uz-cyrl tarjimalari (web, mobil, backend xabarlari)
- [ ] Hisobot eksporti (Excel/PDF)
- [ ] Production Docker Compose (backend, web, nginx, backup cron)
- [ ] Kunlik zaxira nusxa + tiklash tekshiruvi
- [ ] Yuklama va xavfsizlik tekshiruvi (tenant-izolyatsiya audit)
- [ ] Seed/demo ma'lumotlar, pilot firma onboarding qo'llanmasi
- [ ] E2E smoke: haydovchi hodisa → xaritada ko'rinadi → chek → AI → tasdiqlash → P&L
