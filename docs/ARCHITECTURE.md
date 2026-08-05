# TruckControl AI — Arxitektura

> Barcha qarorlar `docs/TZ.md` ga asoslanadi. O'zgartirish kiritilsa, avval shu fayl yangilanadi.

## 1. Papkalar tuzilishi

```
Logistika/
├── CLAUDE.md                  # Claude uchun ish qoidalari
├── README.md
├── docker-compose.yml         # postgres, redis, minio (dev-infra)
├── .env.example
├── package.json               # root: pnpm workspaces, umumiy skriptlar
├── pnpm-workspace.yaml
├── tsconfig.base.json         # umumiy TS sozlamalari
├── eslint.config.mjs          # umumiy lint
├── .prettierrc
├── docs/
│   ├── TZ.md                  # texnik topshiriq — manba hujjat
│   ├── ARCHITECTURE.md        # ushbu fayl
│   └── ROADMAP.md             # 9 bosqichli reja
├── apps/
│   ├── backend/               # NestJS API
│   │   ├── prisma/            # schema.prisma, migratsiyalar, seed
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── common/        # guard, interceptor, filter, dekorator, api-javob
│   │       ├── config/        # env validatsiyasi, konfiglar
│   │       ├── i18n/          # backend xabar tarjimalari (uz-latn, ru, uz-cyrl)
│   │       └── modules/
│   │           ├── auth/          ├── companies/     ├── users/
│   │           ├── vehicles/      ├── trips/         ├── events/
│   │           ├── tracking/      ├── fuel/          ├── expenses/
│   │           ├── documents/     ├── finance/       ├── reports/
│   │           ├── ai/            ├── notifications/ ├── files/
│   │           └── public-link/   # mijoz kuzatuv havolasi
│   └── web/                   # React 18 + Vite
│       └── src/
│           ├── app/           # router, provider'lar, layout
│           ├── shared/        # api-klient, ui-kit, i18n, util
│           ├── features/      # auth, vehicles, trips, map, fuel, docs,
│           │                  # finance, dashboard, ai-chat, settings
│           └── pages/
├── packages/
│   └── shared/                # backend↔web umumiy TS tiplari:
│                              # API javob shakli, enum'lar, DTO tiplari
└── mobile/                    # Flutter (pnpm workspace'ga KIRMAYDI)
    └── truckcontrol_driver/
        └── lib/
            ├── core/          # api, offline navbat (drift), gps, i18n
            └── features/      # auth, trip, events, fuel_photo, sync
```

**Nega shunday:** `apps/*` + `packages/shared` — pnpm workspaces'ning standart shakli;
`shared` paketi API kontraktini (tiplar, enum, javob formati) bir joyda saqlab, backend va web
orasidagi nomuvofiqlikni yo'qotadi. Flutter — Dart bo'lgani uchun workspace'dan tashqarida,
lekin bitta repoda turadi (bitta PR'da butun funksiya o'zgaradi).

## 2. Backend modullari va bog'liqliklar

| Modul | Vazifasi | Bog'liq |
|---|---|---|
| `auth` | JWT (access+refresh), login (email/parol; haydovchi: telefon+kod), rol guard'lari | users, companies |
| `companies` | Tenant CRUD, tarif limiti, sozlamalar (vaqt mintaqasi, yoqilg'i chegarasi) | — |
| `users` | Foydalanuvchilar, rollar (OWNER/LOGIST/DRIVER) | companies |
| `vehicles` | Texnika kartochkasi, holati, normasi | companies |
| `trips` | Reys hayot sikli, marshrut, kirim | vehicles, users |
| `events` | Haydovchi hodisalari (8 tugma), offline-sinxron qabul (idempotent) | trips, files |
| `tracking` | GPS nuqtalar qabul/saqlash, jonli holat, trek tarixi | vehicles, trips |
| `fuel` | Yoqilg'i quyishlar, norma-taqqoslash | trips, documents, finance |
| `expenses` | Xarajatlar/kirimlar, to'lov holati | trips |
| `documents` | Hujjat meta + muddat eslatmalari, AI-o'qish takliflarini tasdiqlash oqimi | files, ai |
| `finance` | **Deterministik hisob-kitob**: reys P&L, rentabellik, norma (TZ 6-bo'lim) | trips, fuel, expenses |
| `reports` | Dashboard agregatlar, davr hisobotlari, AI uchun whitelist hisobot funksiyalari | finance |
| `ai` | Claude klienti, OCR-ekstraktsiya, chat (tool-use → faqat `reports` funksiyalari), anomaliya izohlari, Whisper | reports, documents, notifications |
| `notifications` | Telegram bot, ilova ichi bildirishnoma, kunlik 20:00 xulosa (BullMQ cron) | reports, companies |
| `files` | MinIO yuklash/olish, imzolangan URL, tenant-prefiks | — |
| `public-link` | Autentifikatsiyasiz mijoz havolasi (muddatli token, bitta reys) | trips, tracking |

Bog'liqlik yo'nalishi pastdan yuqoriga oqadi: `finance` hech qachon `ai` ga bog'lanmaydi
(AI moliyani chaqiradi, aksincha emas) — TZ'dagi «moliyani AI emas, kod hisoblaydi» qoidasining
strukturaviy kafolati.

## 3. Autentifikatsiya va multi-tenant strategiyasi

**Tenant modeli: bitta baza, umumiy sxema, har jadvalda `company_id`.**

- Nega: 5–40 texnikali yuzlab mayda firmalar — jadval-boshiga-baza yoki sxema-boshiga-tenant
  operatsion jihatdan ortiqcha; bitta VPS + Docker Compose deploy'ga mos; backup bitta.
- **Himoya qatlamlari (uchtasi ham majburiy):**
  1. **JWT ichida `companyId`** — token'dan olinadi, hech qachon so'rov parametridan emas.
  2. **Prisma Client Extension** — tenant-jadvallarga har `find/update/delete` so'roviga
     `company_id` filtrini avtomatik qo'shadi; filtrsiz so'rov xato beradi. Bu «unutib qo'yish»
     xavfini yopadi.
  3. **PostgreSQL Row-Level Security (RLS)** — sessiya o'zgaruvchisi orqali oxirgi qatlam
     (Prisma qatlamida xato bo'lsa ham baza o'tkazmaydi).
- `SUPERADMIN` alohida guard bilan, tenant ma'lumotlariga kirmaydi (faqat agregat/holat).

**Auth oqimi:**
- Ofis (OWNER/LOGIST): email + parol (argon2) → access JWT (15 daq) + refresh (30 kun, rotatsiya).
- Haydovchi: telefon raqami + SMS-kod (yoki logist bergan bir martalik PIN) → uzoq muddatli
  refresh (telefon — ish quroli, tez-tez login qilinmaydi).
- Mijoz havolasi: JWT emas — imzolangan, muddatli, bitta reysga bog'langan token URL ichida.
- Rollar: NestJS guard + dekorator (`@Roles('OWNER')`).

## 4. API endpoint'lar (guruhlar bo'yicha)

Barcha javoblar: `{ success, data, error, meta }` (global interceptor + exception filter).
Prefiks: `/api/v1`. Ro'yxatlar: `?page=&limit=&sort=` → `meta.pagination`.

### auth
- `POST /auth/login` — email/parol
- `POST /auth/driver/request-code` · `POST /auth/driver/verify` — haydovchi kirishi
- `POST /auth/refresh` · `POST /auth/logout`
- `GET  /auth/me`

### companies (OWNER)
- `GET/PATCH /company` — o'z kompaniyasi, sozlamalar (vaqt mintaqasi, chegaralar)

### users (OWNER/LOGIST)
- `GET/POST /users` · `GET/PATCH/DELETE /users/:id`

### vehicles
- `GET/POST /vehicles` · `GET/PATCH/DELETE /vehicles/:id`
- `GET /vehicles/:id/documents` · `GET /vehicles/:id/profitability`

### trips
- `GET/POST /trips` · `GET/PATCH /trips/:id` · `POST /trips/:id/close`
- `GET /trips/:id/timeline` — hodisalar lentasi
- `GET /trips/:id/pnl` — reys foydasi (finance)
- `POST /trips/:id/share-link` — mijoz havolasi yaratish

### events (haydovchi, offline-sinxron)
- `POST /events/batch` — idempotent paket qabul (klient UUID bilan)
- `GET  /events?tripId=`

### tracking
- `POST /tracking/positions` — GPS paket (haydovchi ilovasidan)
- `GET  /tracking/live` — barcha mashinalar joriy holati (xarita)
- `GET  /tracking/vehicles/:id/history?from=&to=` — trek tarixi

### fuel
- `GET/POST /fuel` · `PATCH /fuel/:id`
- `GET /fuel/deviations?vehicleId=&period=` — norma chetlashishlari

### expenses
- `GET/POST /expenses` · `PATCH/DELETE /expenses/:id`
- `GET/POST /incomes` · `PATCH /incomes/:id` — kirimlar, to'lov holati

### documents
- `GET/POST /documents` · `GET/PATCH/DELETE /documents/:id`
- `POST /documents/:id/approve` · `POST /documents/:id/reject` — AI taklifini tasdiqlash
- `GET  /documents/expiring?days=` — muddati yaqinlar

### reports (dashboard)
- `GET /reports/dashboard` — boshliq ekrani agregatlari
- `GET /reports/profit?groupBy=month|vehicle|driver&from=&to=`
- `GET /reports/export?format=xlsx|pdf`

### ai
- `POST /ai/extract` — foto → strukturalangan taklif (natija `documents` draft'iga)
- `POST /ai/chat` — savol → javob (faqat whitelist hisobot tool'lari orqali)
- `GET  /ai/alerts` · `POST /ai/alerts/:id/ack` — anomaliya ogohlantirishlari
- `POST /ai/transcribe` — ovoz → matn (Whisper)

### notifications
- `GET /notifications` · `POST /notifications/read`
- `POST /notifications/telegram/link` — Telegram akkauntni ulash

### files
- `POST /files/upload` → MinIO, meta qaytadi
- `GET  /files/:id/url` — imzolangan, muddatli URL

### public (autentifikatsiyasiz)
- `GET /public/track/:token` — mijoz uchun yuk holati + joy

## 5. Asosiy qarorlar va sabablari

| Qaror | Sabab |
|---|---|
| Bitta baza + `company_id` + Prisma extension + RLS | Yuzlab mayda tenant uchun eng arzon va boshqariladigan izolyatsiya; uch qatlamli himoya bitta unutilgan filtr xatosini ham o'tkazmaydi. |
| Pul — BigInt tiyinda | `float` yaxlitlash xatolari moliyaviy tizimda mumkin emas; BigInt Postgres/Prisma/JS'da tabiiy qo'llanadi. |
| `finance` AI'dan to'liq ajratilgan | TZ 6-bo'lim: raqamlar deterministik; AI xato qilsa ham pul hisobiga ta'sir qilmaydi (sotuv va'dasi ham shu). |
| AI chat — faqat tool-use, SQL yo'q | Xavfsizlik (injection, tenant-izolyatsiya) va javoblar tekshiriladigan bo'lishi uchun; tool'lar `reports` modulining oddiy funksiyalari. |
| AI natijasi — draft + odam tasdig'i | «AI xato qilsa-chi?» savoliga mahsulot javobi; bazaga yozish huquqi faqat odamda. |
| Offline-first mobil (lokal navbat, idempotent batch API) | O'zbekiston yo'llarida aloqa uzilishi norma; klient UUID idempotentlik takroriy yuborishda dublikat yaratmaydi. |
| GPS: oddiy REST batch, WebSocket keyin | MVP'da 30–60 soniyalik yangilanish yetarli; jonli xarita polling/TanStack Query bilan boshlanadi, WS — optimizatsiya bosqichida. |
| Redis: BullMQ (cron, AI navbatlari) + kesh | Kunlik xulosa, hujjat eslatmalari, og'ir AI ishlov navbatlari — hammasi bitta Redis'da. |
| pnpm workspaces + `packages/shared` | API kontrakt tiplari bir manbadan; backend va web hech qachon ajralib ketmaydi. |
| i18n: kalitlar backend va web/mobilda, default `uz-latn` | TZ talabi; xabar kodlari backend'dan `error.code` sifatida qaytadi, matnga klient aylantiradi. |
