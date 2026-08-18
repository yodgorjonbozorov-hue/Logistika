# CLAUDE.md — TruckControl AI ish qoidalari

## Loyiha nima haqida

TruckControl AI — O'zbekiston logistika firmalari (5–40 texnika) uchun multi-tenant SaaS:
reyslar, GPS-kuzatuv, yoqilg'i va xarajat nazorati, hujjatlar hamda har mashina/reys bo'yicha
real foyda hisobi. AI chek/hujjat fotosini o'qiydi, boshliq savollariga hisobotlardan javob
beradi va anomaliyalarni topadi — lekin hech narsani o'zi bazaga yozmaydi. Uch interfeys:
haydovchi (Flutter mobil, offline-first), logist (React web), boshliq (web + Telegram).

**Har seans boshida o'qi:** `docs/TZ.md` (talablar), `docs/ARCHITECTURE.md` (qarorlar),
`docs/ROADMAP.md` (joriy bosqich). Seans oxirida ROADMAP'dagi bajarilgan punktlarni belgila.

## Papka tuzilishi

```
apps/backend/        NestJS + Prisma + Redis (modullar: src/modules/*)
apps/web/            React 18 + Vite + Tailwind + TanStack Query
packages/shared/     Backend↔web umumiy TS tiplari (API kontrakt, enum'lar)
mobile/truckcontrol_driver/   Flutter haydovchi ilovasi (workspace'dan tashqarida)
docs/                TZ.md, ARCHITECTURE.md, ROADMAP.md
docker-compose.yml   postgres, redis, minio (dev-infra)
```

To'liq tuzilish va modullar bog'liqligi — `docs/ARCHITECTURE.md`.

## MUHIM QOIDALAR

- Har bir baza so'rovi MAJBURIY `company_id` bo'yicha filtrlanadi.
  Bu multi-tenant xavfsizligining asosi. Istisno yo'q.
- Pul UZS uchun `BigInt` (tiyinda) yoki `Decimal` — HECH QACHON `float` emas.
- Barcha vaqtlar bazada UTC, foydalanuvchiga mahalliy vaqtda ko'rsatiladi.
- Har API javobi bir xil formatda: `{ success, data, error, meta }`.
- Foydalanuvchi ko'radigan barcha matn i18n orqali: uz-latn (asosiy), ru, uz-cyrl.
  Kodga qattiq yozilgan matn bo'lmasin.
- AI hech qachon bazaga to'g'ridan-to'g'ri yozmaydi va SQL yozmaydi.
- Moliyaviy hisob-kitobni AI emas, oddiy kod bajaradi (TZ 6-bo'lim).
- Har modul uchun test yoziladi.

## Kod yozish qoidalari

### Naming

- Fayllar: kebab-case (`fuel-entry.service.ts`); NestJS suffikslari: `.module.ts`,
  `.controller.ts`, `.service.ts`, `.dto.ts`, `.spec.ts`.
- Klasslar `PascalCase`, o'zgaruvchi/funksiya `camelCase`, konstantalar `UPPER_SNAKE`.
- Baza (Prisma): jadval/ustun `snake_case` (`@@map`/`@map` bilan), model `PascalCase`.
- Kod, identifikatorlar va commit xabarlari — inglizcha; foydalanuvchi matnlari — faqat i18n
  kalitlari orqali (default `uz-latn`).
- React komponentlar `PascalCase.tsx`, hook'lar `useXxx.ts`. Flutter/Dart: `snake_case` fayllar.

### Error handling

- Backend: xatolar `AppException(code, httpStatus, params)` orqali; global exception filter
  ularni `{ success:false, error:{ code, message, details } }` ga aylantiradi. `error.code` —
  mashina o'qiydigan kalit (`AUTH_INVALID_CREDENTIALS`), klient uni i18n orqali matnga aylantiradi.
- Hech qachon xatoni yutib yuborma (bo'sh `catch` taqiqlanadi); kutilmagan xato — log + 500 +
  umumiy kod. AI chaqiruvlari doim timeout + retry bilan, xatosi foydalanuvchi oqimini bloklamaydi.
- Web: TanStack Query'ning `error` holati orqali; mobil: offline navbat xatoni saqlab qayta uradi.

### Validatsiya

- Har controller kirishi DTO + `class-validator` (`ValidationPipe` global, `whitelist: true`).
- `companyId` va `userId` HECH QACHON body/query'dan olinmaydi — faqat JWT'dan (guard →
  `@CurrentUser()`). Body'da kelgan `companyId` e'tiborsiz qoldiriladi.
- Env o'zgaruvchilar start'da sxema bilan tekshiriladi (`config/` moduli) — yetishmasa app ko'tarilmaydi.
- AI'dan kelgan JSON ham xuddi tashqi kirish kabi validatsiya qilinadi.

## Qanday ishga tushiriladi

```bash
docker compose up -d          # postgres :5432, redis :6379, minio :9000/:9001
cp .env.example .env          # qiymatlarni to'ldir (SEED_SUPERADMIN_PASSWORD majburiy)
pnpm install
pnpm --filter backend prisma migrate deploy   # mavjud migratsiyalarni qo'llash
pnpm --filter backend db:seed                 # SUPERADMIN + (dev'da) demo tenant
pnpm dev                      # backend + web parallel
# Flutter: cd mobile/truckcontrol_driver && flutter run
```

- `.env` monorepo ildizida yagona — backend uni `envFilePath` orqali o'qiydi, Prisma CLI esa
  `dotenv -e ../../.env` bilan (`apps/backend` skriptlari).
- Sxema o'zgarsa: `pnpm --filter backend prisma migrate dev --name <izoh>` va migratsiya
  faylini commit qil. `db push` ishlatilmaydi.

## Qanday test qilinadi

```bash
pnpm test                     # barcha workspace testlari
pnpm --filter backend test    # NestJS unit (Jest); e2e: test:e2e (alohida test-baza)
pnpm --filter web test        # Vitest + React Testing Library
pnpm lint && pnpm format:check
# Flutter: flutter test
```

- Har yangi servis/funksiya bilan birga test yoziladi — keyinga qoldirilmaydi.
- Multi-tenant izolyatsiya testi majburiy: har modul e2e'sida «B kompaniya foydalanuvchisi
  A kompaniya resursini ko'ra olmaydi» stsenariysi bo'lishi shart.
- `finance` moduli — eng yuqori qamrov: P&L, norma, yaxlitlash chegara holatlari bilan.

## Audit tuzatishlaridan kelib chiqqan konventsiyalar

Bularning **nima uchun** shundayligi — `docs/BUSINESS-RULES.md`; nima
o'zgargani — `docs/FIX-REPORT.md`.

### Pul va yozuvlar

- **`Idempotency-Key` majburiy** — barcha pul va reys endpointlarida
  (`@Idempotent()`). Klient kalitni **bir marta** mint qiladi va qayta
  urinishda **o'shani** yuboradi; har chaqiruvda yangi kalit — idempotency
  yo'qligi bilan barobar.
- **Ledger o'zgarmas.** Tuzatish faqat `REVERSAL` yozuvi bilan; UPDATE/DELETE
  baza darajasida taqiqlangan. `Client.balance` — kesh, faqat atomik
  `increment` bilan yangilanadi.
- **`amountBase` + `rateUsed`/`rateDate`** — har pul yozuvida. Kursni bugungisi
  bilan qayta hisoblash taqiqlanadi.
- **Nol summa yaroqli emas** — `@IsPositiveTiyin()` (xarajat, kirim, reys
  narxi). `@IsTiyin()` faqat nol ma'noli bo'lgan joyda (masalan avans).

### Bir vaqtdalik

- **Optimistik qulf**: `updateMany({ where: { id, status, version } })` va
  `count === 0` → 409. Read-modify-write yozilmaydi.
- **Cron'lar** `CronLockService.runExclusive()` ostida. Qulf ish tugagach
  **bo'shatilmaydi** — TTL bilan tugaydi.
- **Fon ishlari** `JobsService.enqueue()` orqali; hech qayerda to'g'ridan-to'g'ri
  `Queue`/`Worker` ochilmaydi. `JOBS_INLINE=true` — testlar va lokal ishlash.

### Ro'yxatlar

- **`readPage(dto, find, count)`** — sahifadan bitta ortiq qator o'qiydi,
  `hasMore` shundan keladi. `?withTotal=false` bo'lsa `count()` bajarilmaydi.
- **`skip` — getter emas, `skipOf(dto)` funksiyasi.** `IntersectionType`
  prototip getter'ini yo'qotadi (N-10).
- Qo'lda yozilgan migratsiya **indeks yaratsa, u `schema.prisma`da ham e'lon
  qilinishi shart** — aks holda keyingi `migrate dev` uni o'chirishni taklif
  qiladi (N-12).

### Web

- **Rollar bitta jadvalda**: `app/routes.ts` — router ham, yon menyu ham
  o'shani o'qiydi, va u backend `@Roles` bilan **aynan mos** bo'lishi kerak.
- Rol **`/auth/me` dan** olinadi, `localStorage`dan emas.
- **Klient validatsiyasi serverdan qattiqroq bo'lmasligi kerak.** API qabul
  qiladigan narsani rad etadigan klient — umuman tekshirmaganidan yomonroq.
- Pul kiritishda **`MoneyInput`** (guruhlash + «so'm»), `type="number"` emas.
- Yorug' rejimda matn uchun **`-text` rang tokenlari**
  (`text-accent-text dark:text-accent`) — brend ranglari oq fonda WCAG AA dan
  o'tmaydi. Palitra `shared/ui/palette.json` da, kontrast testi bilan qotirilgan.

### Mobil

- **Foto — dalil.** Yuklanmagan foto bilan hodisa yuborilmaydi va `synced`
  qilinmaydi (fayl diskda bo'lsa). Fayl o'chgan bo'lsa — fotosiz ketadi.
- Barcha HTTP `ApiClient` orqali (refresh bilan); javob **`jsonDecode`** bilan
  o'qiladi, regex bilan emas.
