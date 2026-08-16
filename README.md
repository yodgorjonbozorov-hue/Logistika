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
| [`docs/PILOT.md`](docs/PILOT.md)               | Pilot firmani ishga tushirish qo'llanmasi  |
| [`docs/DEPLOY.md`](docs/DEPLOY.md)             | Production'ga o'rnatish, HTTPS, zaxira     |
| [`CLAUDE.md`](CLAUDE.md)                       | Ishlab chiqish qoidalari                   |

## Texnik stek

NestJS · PostgreSQL · Prisma · Redis · React 18 + Vite + Tailwind + TanStack Query ·
Flutter · MinIO · Anthropic Claude API · Whisper · OpenStreetMap/Leaflet · Docker Compose

## Tuzilish

```
apps/backend/      NestJS API (Prisma, BullMQ, AI)
apps/web/          React web panel (logist + boshliq), telefon va desktopga mos
apps/landing/      Ommaviy sayt (mahsulot taqdimoti, 3 til)
packages/shared/   Umumiy TS tiplari (API kontrakt)
mobile/            Flutter haydovchi ilovasi
docs/              TZ, arxitektura, roadmap
```

## Ishga tushirish (dev)

```bash
docker compose up -d      # postgres, redis, minio
cp .env.example .env      # qiymatlarni to'ldiring
pnpm install
pnpm --filter backend prisma migrate dev
pnpm --filter backend seed   # ixtiyoriy: demo firma (boshliq@demo.uz / demo1234)
pnpm dev                  # backend + web panel
pnpm dev:landing          # ommaviy sayt (http://localhost:5174)
```

Seed bitta alohida tenant yaratadi va qayta ishga tushirilsa dublikat qilmaydi;
`NODE_ENV=production` da `SEED_FORCE=1` bo'lmasa ishlashdan bosh tortadi.

Panelni backendsiz ko'rsatish kerak bo'lsa (demo, dizayn ko'rigi, telefonda ulashish):

```bash
pnpm --filter web dev:demo     # namunaviy ma'lumot bilan, login talab qilmaydi
pnpm --filter web build:demo   # apps/web/dist-demo — statik fayl
```

Demo ma'lumot `apps/web/src/demo/` da; ishlab chiqarish kirish nuqtasi undan hech narsa
import qilmaydi.

Ommaviy saytdagi bog'lanish tugmalari `apps/landing/.env` orqali sozlanadi
(`VITE_CONTACT_PHONE`, `VITE_CONTACT_TELEGRAM`, `VITE_CONTACT_EMAIL`, `VITE_PANEL_URL`) —
namuna uchun `apps/landing/.env.example`. Sozlanmagan kanal saytda ko'rsatilmaydi.

Batafsil — [`CLAUDE.md`](CLAUDE.md).
