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
docker compose up -d      # postgres, redis, minio
cp .env.example .env      # qiymatlarni to'ldiring
pnpm install              # `shared` ni yig'adi va Prisma Client'ni generatsiya qiladi
pnpm --filter backend migrate              # migratsiyalarni qo'llaydi
pnpm --filter backend seed                 # platforma SUPERADMIN hisobi
pnpm --filter backend seed:demo            # ixtiyoriy: «TruckControl Demo» ma'lumotlari
pnpm dev                                   # backend :3000 + web :5173
```

`pnpm install` ikkita `postinstall` qadamini bajaradi: `packages/shared` yig'iladi
(backend va web uning `d.ts` fayllaridan foydalanadi) va `prisma generate` ishlaydi
(`migrate deploy` klientni generatsiya qilmaydi). Ularni qo'lda ishga tushirish kerak
bo'lsa: `pnpm --filter shared build` va `pnpm --filter backend prisma generate`.

`seed` production uchun mo'ljallangan va faqat SUPERADMIN yaratadi
(`SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD`; production'da bu o'zgaruvchilar
majburiy). `seed:demo` esa alohida demo-tenant yaratadi va `NODE_ENV=production` bo'lsa
ishlamaydi — qayta ishga tushirilsa faqat o'sha demo kompaniyani yangilaydi.

Brauzerda: `http://localhost:5173/` → landing → **Platformaga kirish** → rolga mos panel
(`/dashboard`, `/driver` yoki `/admin`).

## Tekshirish

```bash
pnpm lint && pnpm format:check
pnpm --filter shared build && pnpm -r test   # backend (Jest) + web (Vitest)
pnpm build
```

Batafsil — [`CLAUDE.md`](CLAUDE.md).
