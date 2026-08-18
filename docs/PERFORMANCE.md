# PERFORMANCE — o'lchangan raqamlar (TASK-4.6)

Bu hujjatdagi har bir raqam **haqiqatan olingan**, taxmin emas. Skriptlar
`load-test/` da, ularni qayta ishga tushirish yo'li o'sha yerdagi README'da.

## Muhit — buni birinchi o'qing

| Nima             | Qiymat                                                        |
| ---------------- | ------------------------------------------------------------- |
| Protsessor       | Intel Xeon @ 2.80 GHz, **4 yadro**                            |
| Xotira           | 15 GB                                                         |
| Joylashuv        | **Hammasi bitta konteynerda**: API + Postgres + Redis + MinIO |
| API instansiyasi | 1 ta Node protsessi (cluster yo'q, pgbouncer yo'q)            |
| k6               | v0.55.0, **o'sha mashinada** (generator ham CPU yeydi)        |

> Bu **prod-ga o'xshash muhit emas**. Bitta 4 yadroli mashinada API ham,
> baza ham, yuklama generatori ham birga ishlaydi. Shuning uchun pastdagi
> **absolyut throughput raqami minimal chegara** — prod'da alohida baza va bir
> nechta API instansiyasi bilan u ancha yuqori bo'ladi. Qimmatli bo'lgan narsa —
> **egri chiziq shakli** va **to'yinish nuqtasi**, ular arxitektura haqida
> gapiradi, mashina haqida emas.

## Ma'lumot hajmi

| Jadval           | Qator   |
| ---------------- | ------- |
| `trips`          | 18 400  |
| `ledger_entries` | 100 000 |
| `gps_tracks`     | 267 140 |
| `vehicles`       | **203** |
| `users`          | 2 207   |
| Baza hajmi       | 190 MB  |

203 mashina — TZ'dagi maqsad segmentdan (**5–40 texnika**) **5 baravar katta**.
Ya'ni jonli xarita 40 emas, 200 marker qaytaradi; bu ataylab shunday — dizayn
nuqtasida emas, undan tashqarida ham sinash uchun.

## 1. O'qish ssenariysi (logist brauzeri)

Har iteratsiya: `GET /trips` + `GET /expenses` + `GET /tracking/live`, orada
1 soniya «o'ylash» pauzasi. Har VU — **o'z logini va o'z IP'si**.

| VU  | req/s | `/trips` p95 | `/tracking/live` p95 | Xato |
| --- | ----- | ------------ | -------------------- | ---- |
| 10  | 23.7  | **20.0 ms**  | **38.2 ms**          | 0%   |
| 50  | 105.1 | 136.8 ms     | 167.9 ms             | 0%   |
| 100 | 120.2 | 694.1 ms     | 777.6 ms             | 0%   |
| 200 | 110.0 | 1.66 s       | 1.86 s               | 0%   |

**To'yinish ~50 VU atrofida, throughput shifti ~110–120 req/s.** 100 VU'da
throughput o'smaydi, faqat kechikish o'sadi; 200 VU'da throughput **pasayadi** —
klassik navbat effekti. **Hech bir bosqichda xato yo'q** — tizim to'yinganda
sekinlashadi, yiqilmaydi.

## 2. Yozish ssenariysi (haydovchi telefonlari)

Har iteratsiya: 10 nuqtali GPS paketi, keyin **o'sha paket yana bir marta**
(o'lgan telefon qayta yuboradi). Har VU — o'z haydovchisi va o'z reysi.

| VU  | req/s | `POST /tracking/positions` p95 | Xato |
| --- | ----- | ------------------------------ | ---- |
| 40  | 36.6  | **74.2 ms**                    | 0%   |
| 100 | 79.1  | 304.7 ms                       | 0%   |
| 200 | 101.1 | 1.10 s                         | 0%   |

Har iteratsiyada ikkita tekshiruv bor va **ikkalasi ham 100% o'tdi**:

- `positions stored` — birinchi paketning **hammasi** yozildi (`accepted === 10`);
- `repeat stored nothing` — takroriy paket `accepted: 0, duplicates: 10`.

Baza qatorlari bilan solishtirildi: **364 iteratsiya × 10 nuqta = aynan +3 640
qator**. TASK-4.5 dagi idempotency shu bilan **yuklama ostida** tasdiqlandi,
nafaqat bitta e2e testda.

## 3. Yuklama testi topgan haqiqiy xato: `/trips` indekssiz edi

Bu kodni o'qib emas, **o'lchab** topildi.

```
-- OLDIN
Limit  (actual time=13.793..13.801 rows=21)
  Buffers: shared hit=670
  ->  Sort  (Sort Key: created_at DESC, top-N heapsort)
        ->  Seq Scan on trips  (rows=18001)
```

Filtersiz reyslar ro'yxati — **ilovada eng ko'p ochiladigan ekran** — firmaning
**butun reys tarixini** to'liq skanerlab, yigirmata qator qaytarish uchun
hammasini saralardi. 18k qatorda 13.8 ms; narx firma tarixi bilan **chiziqli
o'sadi**.

```
-- KEYIN: CREATE INDEX trips_company_id_created_at_idx ON trips (company_id, created_at DESC)
Limit  (actual time=0.043..0.128 rows=21)
  Buffers: shared hit=23
  ->  Index Scan using trips_company_id_created_at_idx
```

**13.8 ms → 0.13 ms, 670 → 23 bufer.** Endpoint darajasida (Prisma hydration va
JSON bilan birga): **32.0 ms → 22.8 ms**.

`(company_id, status, created_at DESC)` varianti ham o'lchandi — planner uni
**hech qachon tanlamadi** (selektiv status bilan ham, chuqur offset bilan ham),
shuning uchun u qo'shilmadi. Planner e'tibor bermaydigan indeks — bu foydasiz
yozuv narxi.

## 4. Boshqa o'lchovlar

Bitta so'rov, kutishsiz (`logist` tokeni, 18k reys):

| So'rov                         | Vaqt        |
| ------------------------------ | ----------- |
| `/trips?page=1&limit=20`       | 22.8 ms     |
| `/trips?...&withTotal=false`   | **18.6 ms** |
| `/trips?page=500&limit=20`     | 30.1 ms     |
| `/tracking/live` (203 mashina) | ~30 ms      |
| `/clients`                     | 9.3 ms      |

- **`withTotal=false` 4.2 ms tejaydi** (TASK-4.2). Sahifa so'rovi indeks bilan
  deyarli bepul bo'lgach, `count()` qolgan asosiy narx bo'lib qoldi.
- **Chuqur sahifa (`page=500`) 30.1 ms** — `OFFSET` 10 000 qatorni sanab
  o'tadi. Bu **cursor pagination'ga o'tish uchun trigger**: agar mijozda
  ro'yxatlar shu darajada chuqur varaqlansa. Hozir emas — 20k reysda 30 ms
  qabul qilinadigan, va cursor API kontraktini o'zgartiradi.

## 5. Rate limiter — birinchi shift, va bu to'g'ri

Birinchi urinishda test **97% so'rovda 429** oldi. Sabab tizimda emas, testda
edi: 100 ta VU **bitta login** ostida ishlagan, ya'ni yuzta odam bitta odamning
budjetini bo'lishgan.

O'lchangan chegaralar:

| Cheklov                    | Qiymat                            |
| -------------------------- | --------------------------------- |
| Har foydalanuvchi          | 600 / daqiqa                      |
| Har IP                     | 120 / daqiqa                      |
| `POST /auth/login` har IP  | **5 / daqiqa**                    |
| `POST /tracking/positions` | **60 / daqiqa** har foydalanuvchi |

Bularning hammasi **ataylab**: telefon 2–5 daqiqada bir marta xabar beradi,
ya'ni 60/daqiqa allaqachon haqiqiy tezlikdan ~100 baravar yuqori. Yuklama testi
haqiqiy foydalanuvchilarni modellashi shart — **har VU o'z logini va o'z IP'si
bilan**, aks holda o'lchanadigan narsa ilova emas, anti-abuse qatlami bo'ladi.

Rate limiter'ning o'zi alohida tekshiriladi: `test/rate-limit.e2e-spec.ts`.

## 6. 10 000 foydalanuvchi — tekshirilmadi, sabab bilan

Audit maqsadi «10 000 foydalanuvchida tizim yiqilmasin» edi. **Bu muhitda
o'lchanmadi** va o'lchash ham mantiqsiz: bitta 4 yadroli konteynerda API, baza
va generator birga ishlayotganda 10 000 VU faqat o'sha konteynerning chegarasini
ko'rsatadi, ilova haqida hech narsa aytmaydi.

O'lchangani va aytish mumkin bo'lgani:

- **200 VU'gacha xatolik 0%** — to'yinganda tizim sekinlashadi, yiqilmaydi,
  xato qaytarmaydi, ma'lumot yo'qotmaydi;
- to'yinish **~50 VU / ~110 req/s** bitta 4 yadroli protsessda, hamma narsa
  birga turganda;
- 10 000 foydalanuvchi uchun kerak bo'ladigan narsa arifmetika bilan aytiladi:
  API **stateless** (sessiya Redis'da, RLS ulanish darajasida), ya'ni gorizontal
  kengayadi; cron'lar TASK-4.4 dan beri distributed lock ostida, ya'ni ikkinchi
  instansiya xavfsiz.

**Keyingi qadam (pilotdan oldin):** alohida baza serveri, 2+ API instansiyasi,
`DATABASE_URL` da `connection_limit` va **pgbouncer** — Node protsessi soni ×
Prisma pool > Postgres `max_connections` bo'lishi mumkin. Shundan keyin o'sha
skriptlar bilan qayta o'lchash.

## 7. Ulanish puli

Hozir `DATABASE_URL` da `connection_limit` yo'q — Prisma standart bo'yicha
`num_cpus * 2 + 1` (bu mashinada 9) ulanish oladi. Bitta instansiyada bu
xavfsiz. **Ikki yoki undan ortiq instansiyada** bu raqam ko'payadi va Postgres
`max_connections` (standart 100) ga urilishi mumkin, shuning uchun deployda
`?connection_limit=N` aniq yozilishi va pgbouncer qo'yilishi kerak —
`docs/DEPLOYMENT.md`.
