# Yuklama testi (TASK-4.6)

k6 skriptlari. Har biri **haqiqiy API**ga qarshi ishlaydi — mock yo'q, chunki
o'lchanayotgan narsa aynan baza, indeks va navbat xatti-harakati.

```bash
# 1. Infra va API
docker compose up -d
pnpm --filter backend prisma migrate deploy
pnpm --filter backend build && node apps/backend/dist/main.js

# 2. Ma'lumot (bir marta)
node load-test/seed.mjs                     # 40 mashina, 100k reys, 1M ledger yozuvi

# 3. Ssenariylar
k6 run load-test/scenarios/read-heavy.js    # ro'yxatlar + jonli xarita
k6 run load-test/scenarios/write-heavy.js   # GPS batch + hodisalar
k6 run -e VUS=1000 load-test/scenarios/read-heavy.js
```

## Sozlamalar

| Env        | Standart                | Ma'nosi                                       |
| ---------- | ----------------------- | --------------------------------------------- |
| `BASE_URL` | `http://localhost:3000` | API manzili                                   |
| `VUS`      | `100` (yozishda `40`)   | Bir vaqtdagi virtual foydalanuvchi            |
| `USERS`    | `2000`                  | Seed qilingan login soni (o'qish ssenariysi)  |
| `DURATION` | `30s`                   | Barqaror bosqich uzunligi                     |
| `PASSWORD` | `LoadTest1!`            | Seed paroli (`LOAD_TEST_PASSWORD` bilan seed) |

**Har VU o'z logini va o'z IP'si bilan ishlaydi.** Bu majburiy: rate limiter
foydalanuvchi va IP bo'yicha sanaydi, ya'ni bitta login ostidagi 100 ta VU —
bu yuzta odam bitta odamning budjetini bo'lishishi. Birinchi urinishda test
aynan shu sababdan 97% so'rovda 429 olgan edi.

Yozish ssenariysida **VU soni yo'ldagi reyslardan ko'p bo'lmasligi kerak**:
«bitta haydovchi — bitta faol reys» qoidasi (TASK-3.10) bor, ya'ni ko'proq
telefon uchun ko'proq haydovchi seed qilinadi:
`node load-test/seed.mjs --vehicles 200`.

## Nima o'lchanadi

`http_req_duration` p50/p95/p99, `http_reqs` (throughput), `checks` (xatolik
foizi). Har ssenariyda **threshold** bor: p95 chegaradan oshsa yoki xatolik 1%
dan ko'p bo'lsa k6 nolga teng bo'lmagan kod bilan chiqadi — ya'ni buni CI'ga
qo'yish mumkin.

Natijalar va tahlil: `docs/PERFORMANCE.md`.

## Ogohlantirish

Bu skriptlar **prod-ga o'xshash** muhitda ishlatilishi kerak. Dasturchi
noutbukida yoki bitta konteynerda olingan raqam API haqida emas, o'sha
mashinaning cheklovlari haqida ma'lumot beradi — `docs/PERFORMANCE.md` da qaysi
raqam qayerda olingani aniq yozilgan.
