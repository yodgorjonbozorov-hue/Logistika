# TruckControl AI — Logixa AI

> Mahsulot interfeysi **Logixa AI** brendi ostida (2026 brand board);
> repo, paket va modul nomlari `truckcontrol` bo'lib qoladi.

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
| [`docs/DESIGN.md`](docs/DESIGN.md)             | Logixa AI dizayn tizimi (token, komponent) |
| [`docs/DEPLOY.md`](docs/DEPLOY.md)             | Production deploy (Docker Compose, HTTPS)  |
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
docker compose up -d      # postgres, redis, minio
cp .env.example .env      # qiymatlarni to'ldiring
pnpm install
pnpm dev                  # backend + web
```

## Ishga tushirish (production)

```bash
cp .env.production.example .env.production   # kalitlarni to'ldiring
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Migratsiyalar, birinchi superadmin, HTTPS va backup — [`docs/DEPLOY.md`](docs/DEPLOY.md).

Batafsil — [`CLAUDE.md`](CLAUDE.md).
