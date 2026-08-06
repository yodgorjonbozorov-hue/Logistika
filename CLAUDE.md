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
cp .env.example .env          # qiymatlarni to'ldir
pnpm install
pnpm --filter backend prisma migrate dev   # migratsiyalar (backend paydo bo'lgach)
pnpm dev                      # backend + web parallel
# Flutter: cd mobile/truckcontrol_driver && flutter run
```

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
