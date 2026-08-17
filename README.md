# TruckControl AI

Sun'iy intellektga asoslangan logistika boshqaruv tizimi — O'zbekiston yuk tashish
firmalari (5–40 texnika) uchun SaaS.

> _Furangiz qayerda emas — qancha foyda keltiryapti._

## Nima qiladi

- **Haydovchi** (Flutter, offline-first): reys hodisalarini bitta tugma bilan qayd etadi —
  vaqt, GPS-joy va foto avtomatik.
- **Logist** (web): reys ochadi, jonli xaritada butun parkni ko'radi, AI o'qigan
  chek/hujjatlarni tasdiqlaydi.
- **Boshliq** (web + Telegram): foyda/zarar dashboard'i, AI-chat («shu oy qaysi mashina
  zarar keltirdi?»), avtomatik anomaliya ogohlantirishlari, kunlik xulosa.

## Hujjatlar

| Fayl                                           | Mazmuni                                    |
| ---------------------------------------------- | ------------------------------------------ |
| [`docs/TZ.md`](docs/TZ.md)                     | Texnik topshiriq — barcha talablar manbasi |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Arxitektura, modullar, API, qarorlar       |
| [`docs/ROADMAP.md`](docs/ROADMAP.md)           | 9 bosqichli reja, joriy holat              |
| [`CLAUDE.md`](CLAUDE.md)                       | Ishlab chiqish qoidalari                   |

## Texnik stek

NestJS · PostgreSQL · Prisma · Redis · React 18 + Vite + Tailwind + TanStack Query ·
Flutter · MinIO · Anthropic Claude API · Whisper · OpenStreetMap/Leaflet · Docker Compose

## Tuzilish

```
apps/backend/      NestJS API (Prisma, BullMQ, AI)
apps/web/          React web (logist + boshliq)
packages/shared/   Umumiy TS tiplari (API kontrakt)
mobile/            Flutter haydovchi ilovasi
docs/              TZ, arxitektura, roadmap
```

## Ishga tushirish (dev)

```bash
docker compose up -d                       # postgres, redis, minio
cp .env.example .env                       # qiymatlarni to'ldiring
                                           # SEED_SUPERADMIN_PASSWORD majburiy — default yo'q
pnpm install
pnpm --filter backend prisma migrate deploy   # migratsiyalarni qo'llash
pnpm --filter backend db:seed                 # SUPERADMIN (+ dev'da demo tenant)
pnpm dev                                   # backend + web
```

Seed nima yaratadi:

- **Har doim**: bitta `SUPERADMIN` (`SEED_SUPERADMIN_EMAIL`, paroli
  `SEED_SUPERADMIN_PASSWORD` — yo'q bo'lsa seed xato bilan to'xtaydi). Firma yaratish
  faqat SUPERADMIN huquqida, shuning uchun toza o'rnatishda birinchi qadam shu.
- **Faqat `NODE_ENV !== production`**: demo tenant — OWNER/LOGIST/ACCOUNTANT/DRIVER,
  2 mashina + 1 tirkama, 2 haydovchi, 2 mijoz, 3 reys (COMPLETED / IN_PROGRESS /
  ASSIGNED), hodisalar, xarajatlar va kirim. Kirish: `owner@demo.uz` / `Demo12345!`.

Seed idempotent — qayta ishga tushirilsa dublikat yaratmaydi.

Batafsil — [`CLAUDE.md`](CLAUDE.md).
