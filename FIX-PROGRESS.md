# FIX PROGRESS

Boshlangan: 2026-08-17

## Holat

- [x] PHASE 0 — Baseline
- [ ] PHASE 1 — Blockers (8 ta task)
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

## Bloklangan / keyinga qoldirilgan

(sabab bilan)

- Flutter gate (`flutter analyze`, `flutter test`): **tekshirilmadi** — muhitda Flutter SDK yo'q.
  Mobil tasklar (TASK-1.2, TASK-1.6, TASK-5.4) kodda bajariladi, lekin SDK bilan tasdiqlanmaydi.

## Yangi topilgan muammolar

(audit hisobotida yo'q, ish davomida topilgan)

- **N-1 (info)**: audit'ning baseline bashorati noto'g'ri (yuqoriga qara) — backend unit testlari
  jest `moduleNameMapper` tufayli yashil. Bu TASK-1.3 doirasini kamaytiradi, bekor qilmaydi.

## Keyingi qadam

PHASE 1 → TASK-1.1 (Prisma migratsiyalari va seed).
