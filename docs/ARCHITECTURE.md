# TruckControl AI — Arxitektura

> Barcha qarorlar `docs/TZ.md` (v1.0) ga asoslanadi. TZ bo'limlariga havolalar `TZ §` ko'rinishida.
> O'zgartirish kiritilsa, avval shu fayl yangilanadi.

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
│   ├── TZ.md                  # texnik topshiriq v1.0 — manba hujjat
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
│   │       ├── i18n/          # backend xabar tarjimalari (uz-latn, uz-cyrl, ru)
│   │       └── modules/
│   │           ├── auth/          ├── companies/     ├── users/
│   │           ├── drivers/       ├── clients/       ├── vehicles/
│   │           ├── trips/         ├── events/        ├── tracking/
│   │           ├── fuel/          ├── expenses/      ├── maintenance/
│   │           ├── documents/     ├── finance/       ├── reports/
│   │           ├── alerts/        ├── ai/            ├── chat/
│   │           ├── notifications/ ├── files/         ├── audit/
│   │           └── public-link/   # mijoz kuzatuv havolasi (TZ §4.2)
│   └── web/                   # React 18 + Vite (logist, boshliq, buxgalter)
│       └── src/
│           ├── app/           # router, provider'lar, layout
│           ├── shared/        # api-klient, ui-kit, i18n, util
│           ├── features/      # dashboard, map, trips, fleet, drivers, clients,
│           │                  # finance, fuel, maintenance, docs, reports,
│           │                  # alerts, ai-chat, settings
│           └── pages/         # W-1 … W-11 ekranlari (TZ §4.1)
├── packages/
│   └── shared/                # backend↔web umumiy TS tiplari:
│                              # API javob shakli, enum'lar, DTO tiplari
└── mobile/                    # Flutter (pnpm workspace'ga KIRMAYDI)
    └── truckcontrol_driver/   # E-1 … E-7 ekranlari (TZ §3.2)
        └── lib/
            ├── core/          # api, offline navbat (drift), gps fon servisi, i18n
            └── features/      # auth, home, trip, events (10 tugma), expenses,
                               # documents, profile, chat, sync
```

**Nega shunday:** `apps/*` + `packages/shared` — pnpm workspaces'ning standart shakli;
`shared` paketi API kontraktini (tiplar, enum, javob formati) bir joyda saqlab, backend va web
orasidagi nomuvofiqlikni yo'qotadi. Flutter — Dart bo'lgani uchun workspace'dan tashqarida,
lekin bitta repoda turadi (bitta PR'da butun funksiya o'zgaradi).

## 2. Backend modullari va bog'liqliklar

Baza jadvallari TZ §5 da to'liq berilgan — Prisma sxemasi aynan o'sha tuzilishga quriladi
(`snake_case` jadval/ustun, `@@map`/`@map` bilan).

| Modul           | Vazifasi (TZ havola)                                                                                                                                | Bog'liq                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `auth`          | JWT (access+refresh), login: ofis — email/parol, haydovchi — telefon+SMS yoki logist bergan login/parol (TZ §3.2 E-1); rol guard'lari (RBAC, TZ §9) | users                               |
| `companies`     | Tenant CRUD, tarif/obuna (`tariff_plan`, `subscription_until`), sozlamalar                                                                          | —                                   |
| `users`         | Foydalanuvchilar, rollar: OWNER / LOGIST / ACCOUNTANT / DRIVER (TZ §2)                                                                              | companies                           |
| `drivers`       | Haydovchi profili: guvohnoma, ish haqi turi (fixed/percent/per_km), avans/qoldiq hisobi, reyting (TZ §4.1 W-6, §5)                                  | users                               |
| `clients`       | Mijozlar bazasi, to'lov shartlari, balans, qarzdorlar (TZ §5)                                                                                       | companies                           |
| `vehicles`      | Texnika kartochkasi: norma, probeg, hujjat muddatlari, TO ko'rsatkichi (TZ §4.1 W-5)                                                                | companies                           |
| `trips`         | Reys hayot sikli (draft→assigned→in_progress→completed/cancelled), marshrut, narx, avans, spidometr (TZ §5 trips)                                   | vehicles, drivers, clients          |
| `events`        | 10 ta status tugmasi hodisalari (TZ §3.2 E-3), offline-sinxron idempotent qabul (`is_synced`, klient UUID)                                          | trips, files                        |
| `tracking`      | GPS nuqtalar (2–5 daqiqa interval, paketli), jonli holat, trek tarixi, marshrutdan chetlash (TZ §3.3, §4.1 W-2)                                     | vehicles, trips                     |
| `fuel`          | Yoqilg'i jurnali, norma-taqqoslash, farq/zarar jadvali, AZS tahlili (TZ §4.1 W-8)                                                                   | trips, finance                      |
| `expenses`      | Xarajatlar (kategoriyalar TZ §5) + kirimlar (`incomes`, to'lov holati), tasdiqlash (`is_approved`)                                                  | trips, clients                      |
| `maintenance`   | TO va ta'mir tarixi, keyingi TO rejasi (TZ §5 maintenance)                                                                                          | vehicles                            |
| `documents`     | Hujjat meta (owner: vehicle/driver/company/trip), muddat eslatmalari 15/7/1 kun (TZ §4.1 W-10)                                                      | files                               |
| `finance`       | **Deterministik hisob-kitob** — TZ §6 formulalari: reys foydasi, amortizatsiya, 1 km tannarxi, yoqilg'i farqi, ROI                                  | trips, fuel, expenses, maintenance  |
| `reports`       | Dashboard agregatlar (W-1), hisobotlar (W-9), Excel/PDF eksport, AI uchun whitelist funksiyalar (TZ §8.4)                                           | finance                             |
| `alerts`        | Ogohlantirishlar markazi (W-10): hujjat muddati, TO, qimirlamaslik, chetlash, norma, to'lov                                                         | documents, tracking, fuel, expenses |
| `ai`            | Claude klienti; AI-1…AI-8 funksiyalari bosqichma-bosqich (TZ §8); `ai_requests`, `ai_insights`, `ai_settings` jadvallari (TZ §8.10)                 | reports, alerts, files              |
| `chat`          | Logist ↔ haydovchi chat: matn + foto + ovozli xabar (TZ §3.2 E-4)                                                                                   | trips, files                        |
| `notifications` | In-app + Telegram bot + FCM push; kunlik 20:00 xulosa (BullMQ cron)                                                                                 | reports, alerts                     |
| `files`         | MinIO yuklash/olish, imzolangan URL, tenant-prefiks; foto siqish max 1500px (TZ §8.3)                                                               | —                                   |
| `audit`         | Audit-log: kim, qachon, nimani o'zgartirdi (TZ §9)                                                                                                  | —                                   |
| `public-link`   | Autentifikatsiyasiz mijoz tracking-havolasi: joy, bosqich, ETA (TZ §4.2)                                                                            | trips, tracking                     |

Bog'liqlik yo'nalishi pastdan yuqoriga oqadi: `finance` hech qachon `ai` ga bog'lanmaydi
(AI moliyani chaqiradi, aksincha emas) — TZ §8.12.7 «moliyaviy raqamni AI hisoblamaydi»
qoidasining strukturaviy kafolati.

## 3. Autentifikatsiya va multi-tenant strategiyasi

**Tenant modeli: bitta baza, umumiy sxema, har jadvalda `company_id`** (TZ §2, §5, §9).

- Nega: 5–50 texnikali yuzlab mayda firmalar — baza-boshiga-tenant operatsion jihatdan
  ortiqcha; bitta VPS + Docker Compose deploy'ga mos (TZ §7); backup bitta.
- **Himoya qatlamlari (uchtasi ham majburiy):**
  1. **JWT ichida `companyId`** — token'dan olinadi, hech qachon so'rov parametridan emas.
  2. **Prisma Client Extension** — tenant-jadvallarga har `find/update/delete` so'roviga
     `company_id` filtrini avtomatik qo'shadi; filtrsiz so'rov xato beradi. Bu «unutib qo'yish»
     xavfini yopadi.
  3. **PostgreSQL Row-Level Security (RLS)** — oxirgi qatlam: Prisma qatlamida xato bo'lsa ham
     baza o'tkazmaydi. Amalga oshirilishi (TASK-2.1):
     - Har tenant jadvalida `ENABLE` + **`FORCE ROW LEVEL SECURITY`** va `tenant_isolation`
       siyosati: `company_id = NULLIF(current_setting('app.company_id', true), '')`
       (`USING` va `WITH CHECK` — o'qish ham, yozish ham).
       `FORCE` shart: usiz jadval **egasi** o'z siyosatini jimgina chetlab o'tadi.
     - Tenant kontekstini `PrismaService` e'lon qiladi: har so'rov
       `SELECT set_config('app.company_id', <uuid>, true)` bilan bitta tranzaksiyada ketadi
       (`true` = tranzaksiya-lokal, ya'ni pool'dagi keyingi so'rovga sizib o'tmaydi).
     - **Ikki DB roli**: `DATABASE_URL` (migratsiya/seed/pre-auth qidiruv, `BYPASSRLS`) va
       `DATABASE_URL_APP` (barcha tenant so'rovlari, `BYPASSRLS` **yo'q**). Bir xil rol
       ishlatilsa RLS kuchga kirmaydi — shuning uchun backend start'da rolni tekshiradi va
       production'da ruxsat bermaydi. Batafsil: `docs/DEPLOYMENT.md` §9.
     - Kontekstsiz ulanish **hech narsa ko'rmaydi** (0 qator), noto'g'ri tenant ham 0 qator —
       `test/rls.e2e-spec.ts` buni cheklangan rol bilan, Prisma extension'ini chetlab o'tib
       isbotlaydi.
     - RLS'dan tashqarida qoldirilganlar: `companies`, `refresh_tokens`, `audit_logs`,
       `tracking_links`, `sms_codes` — ular tenant ma'lum bo'lishidan oldin yoki platforma
       darajasida o'qiladi (`tenant.extension.ts` izohiga qara).
     - Narxi: har tenant so'rovi ikki statement'li tranzaksiya bo'ladi. Bu — izolyatsiyani
       ilova kodiga emas, bazaga yuklashning ataylab to'langan bahosi.
- `SUPERADMIN` (TZ §2 — sotuvchi) alohida guard bilan: firmalarni ro'yxatga olish, obuna
  boshqaruvi; tenant ichki ma'lumotlariga kirmaydi.

**Auth oqimi:**

- Ofis (OWNER/LOGIST/ACCOUNTANT): email/telefon + parol (argon2) → access JWT (15 daq) +
  refresh (30 kun, rotatsiya).
- Haydovchi: telefon + SMS-kod yoki logist bergan login/parol (TZ §3.2 E-1) → uzoq muddatli
  refresh (telefon — ish quroli, tez-tez login qilinmaydi).
- Mijoz havolasi: JWT emas — imzolangan, muddatli, bitta reysga bog'langan token URL ichida.
- Rollar: NestJS guard + dekorator (`@Roles('OWNER')`); barcha o'zgarishlar `audit` logiga.

## 4. API endpoint'lar (guruhlar bo'yicha)

Barcha javoblar: `{ success, data, error, meta }` (global interceptor + exception filter).
Prefiks: `/api/v1`. Ro'yxatlar: `?page=&limit=&sort=` → `meta.pagination`.

### auth

- `POST /auth/login` — email/parol (ofis) yoki login/parol (haydovchi)
- `POST /auth/driver/request-code` · `POST /auth/driver/verify` — telefon+SMS
- `POST /auth/refresh` · `POST /auth/logout` · `GET /auth/me`

### companies (OWNER; superadmin — alohida `/admin` prefiksi)

- `GET/PATCH /company` — o'z firmasi, sozlamalar
- `GET/PATCH /company/ai-settings` — AI sozlamalari (TZ §8.10 ai_settings)
- `ADMIN: GET/POST/PATCH /admin/companies` — firmalar, obuna

### users (OWNER)

- `GET/POST /users` · `GET/PATCH/DELETE /users/:id`

### drivers

- `GET/POST /drivers` · `GET/PATCH/DELETE /drivers/:id`
- `GET /drivers/:id/trips` · `GET /drivers/:id/balance` — avans/qoldiq
- `GET /drivers/:id/rating` — reyting (kechikish, yoqilg'i farqi, nosozlik)

### clients

- `GET/POST /clients` · `GET/PATCH/DELETE /clients/:id`
- `GET /clients/receivables` — qarzdorlar ro'yxati (W-7)

### vehicles

- `GET/POST /vehicles` · `GET/PATCH/DELETE /vehicles/:id`
- `GET /vehicles/:id/documents` · `GET /vehicles/:id/stats` — oylik kirim/chiqim, 1 km tannarxi
- `GET /vehicles/:id/maintenance` — TO tarixi va rejasi

### trips

- `GET/POST /trips` · `GET/PATCH /trips/:id` · `POST /trips/:id/close`
- `GET /trips/:id/timeline` — xronologiya (W-4 tab 1)
- `GET /trips/:id/pnl` — moliya (W-4 tab 2, finance)
- `GET /trips/:id/documents` — hujjatlar (W-4 tab 3)
- `POST /trips/:id/share-link` — mijoz tracking-havolasi

### events (haydovchi, offline-sinxron)

- `POST /events/batch` — idempotent paket qabul (klient UUID, `is_synced`)
- `GET  /events?tripId=`

### tracking

- `POST /tracking/positions` — GPS paket (2–5 daqiqalik yig'ma)
- `GET  /tracking/live` — jonli xarita (W-2)
- `GET  /tracking/vehicles/:id/history?date=` — marshrut tarixi
- `GET  /tracking/deviations` — marshrutdan chetlashlar

### fuel

- `GET/POST /fuel` · `PATCH /fuel/:id`
- `GET /fuel/control?period=` — nazorat jadvali: probeg, norma, real, farq, zarar (W-8)
- `GET /fuel/by-station?period=` — AZS bo'yicha tahlil

### expenses / incomes

- `GET/POST /expenses` · `PATCH/DELETE /expenses/:id` · `POST /expenses/:id/approve`
- `GET/POST /incomes` · `PATCH /incomes/:id` — to'lov holati (pending/partial/paid/overdue)

### maintenance

- `GET/POST /maintenance` · `PATCH /maintenance/:id`
- `GET /maintenance/upcoming` — TO vaqti kelganlar

### documents

- `GET/POST /documents` · `GET/PATCH/DELETE /documents/:id`
- `GET /documents/expiring?days=` — muddati yaqinlar (15/7/1)

### finance / reports

- `GET /reports/dashboard` — W-1 kartalari + hodisa lentasi + 12 oylik grafik
- `GET /reports/profit?groupBy=trip|vehicle|route|driver|client&from=&to=`
- `GET /reports/expense-structure?period=` — pirog diagramma
- `GET /reports/export?report=&format=xlsx|pdf`

### alerts

- `GET /alerts` · `POST /alerts/:id/ack` — ogohlantirishlar markazi (W-10)

### ai (bosqichma-bosqich, TZ §8.13)

- `POST /ai/ocr` — AI-2: foto → strukturalangan taklif + avto-tekshiruvlar (summa, sana, GPS, takroriy chek hash)
- `POST /ai/ocr/:id/confirm` · `POST /ai/ocr/:id/correct` — tasdiqlash/tuzatish (`corrected_data`)
- `POST /ai/voice` — AI-1: ovoz → Whisper → strukturalangan taklif (confidence < 0.7 → qayta so'rash)
- `POST /ai/chat` — AI-3: savol → function calling (faqat whitelist) → javob
- `GET  /ai/insights` · `POST /ai/insights/:id/status` — AI-4 anomaliyalar (confirmed/false_positive/resolved)
- `POST /ai/pricing` — AI-5: marshrut → tannarx + tavsiya narx (4-bosqich)
- `GET  /ai/eta/:tripId` — AI-6 (4-bosqich)
- `POST /ai/diagnosis` — AI-7: nosozlik foto+ovoz → dastlabki tashxis (4-bosqich)
- `GET  /ai/usage` — oylik AI sarfi va limit

### chat

- `GET/POST /chat/:tripId/messages` — matn + foto + ovozli xabar

### notifications

- `GET /notifications` · `POST /notifications/read`
- `POST /notifications/telegram/link` · `POST /notifications/fcm/register`

### files

- `POST /files/upload` → MinIO (foto avtomatik siqiladi, max 1500px)
- `GET  /files/:id/url` — imzolangan, muddatli URL

### public (autentifikatsiyasiz)

- `GET /public/track/:token` — mijoz: yuk qayerda, bosqich, taxminiy yetib borish (TZ §4.2)

## 5. Asosiy qarorlar va sabablari

| Qaror                                                                                     | Sabab                                                                                            |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Bitta baza + `company_id` + Prisma extension + RLS                                        | TZ §2/§9 talabi; uch qatlamli himoya bitta unutilgan filtr xatosini ham o'tkazmaydi.             |
| Pul — BigInt tiyinda; valyuta kodi + kiritilgan kurs alohida saqlanadi                    | `float` yaxlitlash xatolari moliyada mumkin emas; TZ §5 da `currency` (UZS/USD/RUB/KZT) bor.     |
| `finance` AI'dan to'liq ajratilgan                                                        | TZ §8.12.7: foyda/tannarx/farqni kod hisoblaydi, AI faqat izohlaydi.                             |
| AI chat — 2 bosqichli function calling, SQL yo'q                                          | TZ §8.4: AI faqat «qaysi funksiya, qanday parametr»ni tanlaydi; SQL'ni tizim o'zi bajaradi.      |
| AI natijasi — taklif + odam tasdig'i; `corrected_data` logi                               | TZ §8.0/§8.12; tuzatishlar prompt sifatini o'lchash uchun yig'iladi (OCR ≥95%, ovoz ≥90%).       |
| AI xarajat nazorati: model tanlash (Haiku/Sonnet), foto siqish, 24 soat kesh, oylik limit | TZ §8.11: ~$32/oy budjet, limit oshsa sekin rejim + xabar.                                       |
| Offline-first mobil: drift/sqlite navbat + idempotent batch API (klient UUID)             | TZ §3.1 «offline majburiy»; takroriy yuborish dublikat yaratmaydi.                               |
| GPS: 2–5 daqiqa interval, paketli yuborish, fon servisi                                   | TZ §3.3 (batareya tejash); jonli xarita polling bilan boshlanadi, WebSocket — optimizatsiya.     |
| `gps_tracks`: 90 kundan keyin arxivlash (partitsiya/TimescaleDB keyin)                    | TZ §5 eslatmasi — jadval juda tez o'sadi; MVP'da oddiy jadval + arxiv cron yetarli.              |
| Redis: BullMQ (AI navbati, cron, eslatmalar) + kesh                                       | TZ §7 «AI navbat: Redis + worker»; foto/ovoz fonda qayta ishlanadi, foydalanuvchini bloklamaydi. |
| Push — FCM, boshliq kanali — Telegram                                                     | TZ §7; boshliqlar Telegramni doim ochadi, kunlik xulosa (AI-8) shu yerga boradi.                 |
| Xarita — OpenStreetMap + Leaflet / flutter_map                                            | Stek qat'iy; MDH hududini qoplaydi, litsenziya bepul.                                            |
| pnpm workspaces + `packages/shared`                                                       | API kontrakt tiplari bir manbadan; backend va web hech qachon ajralib ketmaydi.                  |
| i18n: uz-latn (default), uz-cyrl, ru; backend `error.code` → klient tarjima qiladi        | TZ §3.1 (3 til); kodga qattiq yozilgan matn taqiqlanadi.                                         |
| Qorong'i rejim — web va mobilda boshidan                                                  | TZ §11 «qorong'i rejim majburiy — haydovchilar tunda ishlaydi».                                  |

---

## 6. Rejalashtirilgan, lekin hali bajarilmagan: `gps_tracks` partitsiyalash

**Holat: rejalashtirilgan, ataylab keyinga qoldirilgan (TASK-4.4, M-9).**

### Muammo

`gps_tracks` — tizimning eng tez o'sadigan jadvali. 40 mashina × 30 soniyalik
interval × yiliga 300 ish kuni ≈ **35 million qator/yil**. TASK-4.1 dan keyin
jonli xarita bu jadvalga umuman tegmaydi va tarix indeks bo'yicha o'qiladi,
ya'ni **o'qish tezligi hozircha muammo emas**. Muammo boshqa joyda:

- 90 kunlik arxivlash `DELETE ... RETURNING` bilan ishlaydi — bu **millionlab
  o'lik qator** qoldiradi, `VACUUM` esa ularni bo'shatadi, lekin diskni
  operatsion tizimga qaytarmaydi;
- retention sweep (`DELETE FROM gps_tracks_archive`) ham xuddi shunday.

Partitsiya bularning ikkalasini ham `DROP TABLE` ga aylantiradi: bir oylik
partitsiyani tashlash — bu bir necha millisekund va **darhol bo'shaydigan disk**.

### Reja (bajarilganda)

1. `gps_tracks` `recorded_at` bo'yicha **native RANGE partitsiya**, oylik
   partitsiyalar (`gps_tracks_2026_08` ...);
2. birlamchi kalit `(id, recorded_at)` bo'lishi shart — Postgres partitsiya
   kalitini har bir unique constraint'ga kiritishni talab qiladi. Bu
   **TASK-4.5 dagi `@@unique([company_id, vehicle_id, recorded_at])` bilan mos**,
   chunki unda `recorded_at` allaqachon bor;
3. keyingi 12 oy uchun partitsiyalarni oldindan yaratadigan va eskisini
   `DETACH` + `DROP` qiladigan oylik cron (TASK-4.4 dagi lock ostida);
4. mavjud ma'lumotni ko'chirish: yangi partitsiyalangan jadval → `INSERT SELECT`
   partiyalar bilan → `ALTER TABLE ... RENAME` almashtirish.

### Nega hozir emas

- **Prisma partitsiyalangan jadvalni ifodalay olmaydi** — u faqat migratsiya
  SQL'ida yashaydi, ya'ni har `migrate dev` uni «yo'q» deb hisoblab
  o'zgartirishga urinadi. Bu N-12 da endigina topilgan tuzoqning aynan o'zi,
  faqat indeks emas, butun jadval miqyosida;
- almashtirish **downtime yoki ehtiyotkor ikki bosqichli deploy** talab qiladi,
  bunday o'zgarishni esa **haqiqiy ma'lumot hajmisiz** sinab bo'lmaydi — hozir
  pilot mijoz yo'q, ya'ni o'lchov ham yo'q;
- foyda bugun **nazariy**: 35M qatorda ham indeksli o'qish tez, disk esa
  arzon. Partitsiya kerak bo'ladigan payt — bu birinchi mijozda 2–3 yillik
  ma'lumot yig'ilgan va `VACUUM` ulgurmay qolgan payt.

**Shart:** birinchi pilot mijozda `gps_tracks` **10 million qatordan** oshsa yoki
kunlik `VACUUM` oynasiga sig'masa — shu reja bo'yicha bajariladi. Shungacha
90 kunlik arxivlash + retention sweep yetarli, va ular endi ishlaydi.
