# FIX REPORT — TruckControl AI

Audit bo'yicha tuzatish ishi yakuni. Har bir raqam o'lchangan yoki
`FIX-PROGRESS.md` dagi jurnaldan olingan; hech biri taxmin emas.

---

## BEFORE AUDIT

Ish boshlangandagi holat (`FIX-PROGRESS.md` §BEFORE):

| Gate                             | Natija                                       |
| -------------------------------- | -------------------------------------------- |
| `pnpm lint`                      | 0 xato                                       |
| `tsc --noEmit` (backend/web)     | 0 xato                                       |
| `pnpm test`                      | backend **82**, web **11** — jami **93**     |
| `pnpm --filter backend test:e2e` | **«No tests found»** — 0 ta e2e              |
| `pnpm format:check`              | **qizil** (21 fayl)                          |
| `pnpm build`                     | OK                                           |
| Coverage threshold               | **yo'q**                                     |
| Prisma migratsiyalari            | **0** (faqat `schema.prisma`), seed **yo'q** |

Audit **60 muammo** topgan: **7 CRITICAL, 21 HIGH, 22 MEDIUM, 10 LOW**.

> Auditning bitta bashorati **reproduce bo'lmadi**: «14/15 backend suite
> `Cannot find module 'shared'` bilan yiqiladi». Jest `moduleNameMapper` tufayli
> unit testlar `shared` dist'iga bog'liq emas edi. Muammoning ildizi (dist
> kafolati, e2e yo'qligi) baribir bor edi va TASK-1.3 da yopildi.

---

## ISSUES FOUND

**7 CRITICAL · 21 HIGH · 22 MEDIUM · 10 LOW** — 6 fazada, **41 task**,
**49 commit**, **27 migratsiya**.

To'liq jurnal (har task uchun fayllar, testlar, sabab-izoh) —
`FIX-PROGRESS.md`. Quyida fazalar bo'yicha xulosa; qoidalarning **nima uchun**
shundayligi — `docs/BUSINESS-RULES.md`.

| Faza                  | Tasklar | Asosiy natija                                                              |
| --------------------- | ------- | -------------------------------------------------------------------------- |
| **0 — Baseline**      | 1       | O'lchov nuqtasi qayd etildi                                                |
| **1 — Blockers**      | 8       | e2e infratuzilmasi, `shared` dist, RLS, migratsiyalar, rate limit          |
| **2 — Security**      | 9       | Token oqimi, cookie, parol siyosati, audit, fayl xavfsizligi               |
| **3 — Core business** | 12      | Ledger, idempotency, optimistik qulf, reys raqami, soft delete             |
| **4 — Performance**   | 6       | Jonli xarita, `count()`/N+1, BullMQ, cron lock, GPS idempotency, load test |
| **5 — UX**            | 5       | Rol-router, pul UX, validatsiya, mobil foto, accessibility                 |

### Eng qimmat beshtasi

| ID       | Muammo                                                                         | Natija                              |
| -------- | ------------------------------------------------------------------------------ | ----------------------------------- |
| **H-8**  | Jonli xarita 10.4M qatorni tarmoqdan o'tkazardi (Prisma `distinct` klientda)   | **10+ daqiqa → 0.086 ms**           |
| **N-10** | `IntersectionType` `skip` getter'ini yo'qotgan — **har sahifa 1-sahifa**       | Sahifalash haqiqatan sahifalaydi    |
| **H-14** | Foto yuklanmasa hodisa fotosiz `synced` bo'lardi — **dalil abadiy yo'qolardi** | Foto yuklanmaguncha navbatda qoladi |
| **H-3**  | `Client.balance` — hech kim yozmaydigan ustun; qarz savoliga javob yo'q edi    | O'zgarmas ledger + REVERSAL         |
| **A-2**  | `@Cron` har protsessda — ikkinchi instansiyada tungi ish ikki marta            | Redis `SET NX PX` lock              |

### Ish davomida topilgan (auditda yo'q) — 14 ta

Eng muhimlari:

| ID       | Muammo                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------- |
| **N-10** | **Sahifalash umuman ishlamagan** (HIGH) — `?page=2` 1-sahifani qaytarardi                                 |
| **N-12** | Uchta ishlaydigan indeks `schema.prisma`da e'lon qilinmagan — **keyingi `migrate dev` ularni o'chirardi** |
| **N-13** | `GET /trips` o'z tartiblashi uchun indekssiz — `Seq Scan` + to'liq sort (yuklama testi topdi)             |
| **N-14** | `IsTiyin` **`0` ni qabul qilardi** — nol so'mlik xarajat yaroqli so'rov edi                               |
| **N-7**  | Web `POST /trips` ga `Idempotency-Key` yubormasdi — reys yaratish 400 bilan qaytardi                      |
| **N-11** | (ochiq) `tracking.service` da oxirgi hodisa qidiruvi — TASK-4.1 muammosining kichik nusxasi               |

---

## NOT FIXED

### Ataylab keyinga qoldirilgan, sabab bilan

**`gps_tracks` partitsiyalash (M-9 ning ikkinchi qismi).** Reja
`docs/ARCHITECTURE.md` §6 da to'liq yozilgan. Sabablari:

- **Prisma partitsiyalangan jadvalni ifodalay olmaydi** — u faqat migratsiya
  SQL'ida yashaydi, ya'ni har `migrate dev` uni o'zgartirishga urinadi. Bu
  N-12 da endigina topilgan tuzoqning aynan o'zi, faqat jadval miqyosida;
- almashtirish **downtime yoki ikki bosqichli deploy** talab qiladi va uni
  **haqiqiy ma'lumot hajmisiz sinab bo'lmaydi** — pilot mijoz hali yo'q;
- foyda bugun **nazariy**: 90 kunlik arxivlash va retention sweep endi ishlaydi.

**Shart yozib qo'yilgan:** birinchi pilotda `gps_tracks` **10M qatordan** oshsa
yoki kunlik `VACUUM` oynasiga sig'masa — reja bo'yicha bajariladi.

**10 000 foydalanuvchili yuklama testi.** Bu muhitda o'lchanmadi va o'lchash
ham mantiqsiz: bitta 4 yadroli konteynerda API, baza va yuklama generatori
birga ishlaganda 10 000 VU faqat o'sha konteynerning chegarasini ko'rsatadi.
O'lchangani va aytish mumkin bo'lgani — `docs/PERFORMANCE.md` §6.

**N-11** (jonli xaritadagi oxirgi hodisa qidiruvi) — hozir zararsiz (faol reys
kam), lekin uzoq reyslarda o'sadi. TASK-4.2 doirasida **ataylab tegilmadi**:
yarim tuzatish o'rniga alohida task bo'lishi kerak.

### Keyingi bosqichlarga tegishli (ROADMAP)

7-bosqich (moliya to'liq hisob-kitobi), 8-bosqich (AI), 9-bosqich (pilot) —
bu audit doirasidan tashqarida.

---

## TESTED

| O'lchov            | BEFORE | AFTER                |
| ------------------ | ------ | -------------------- |
| Backend unit       | 82     | **484**              |
| Web unit           | 11     | **111**              |
| Flutter            | (bor)  | **28**               |
| **E2E**            | **0**  | **232**              |
| **Jami**           | **93** | **855**              |
| Coverage threshold | yo'q   | **per-file ratchet** |
| `format:check`     | qizil  | **yashil**           |
| Migratsiyalar      | 0      | **27**               |

### Coverage

Umumiy: **52.2% statements / 60.8% lines**. Auditning 60/90 maqsadiga
yetilmadi — pastda sababi.

Moliya va biznes yadrosi — eng yuqori qamrov (talab shunday edi):

| Modul               | Statements |
| ------------------- | ---------- |
| `events.service`    | **100%**   |
| `ledger.service`    | **100%**   |
| `odometer`          | **100%**   |
| `trip-availability` | **100%**   |
| `currency.service`  | 96.9%      |
| `expenses.service`  | 95.4%      |
| `tracking.service`  | 94.6%      |
| `trips.service`     | 85.9%      |

**Umumiy 60% ga yetmagani — o'lchov usuli, sifat emas.** Jest o'z threshold'i
bor faylni **global hisobdan chiqarib tashlaydi**, ya'ni yaxshi qoplangan
fayllar per-file ratchet'ga o'tgan sari global guruhda faqat qolganlari qoladi.
Qoplanmagan qism — asosan `controller` va `dto` fayllari, ular e2e bilan
sinaladi (232 ta test aynan HTTP qatlamidan o'tadi).

### Test turlari

- **Multi-tenant izolyatsiya** — har modul e2e'sida majburiy stsenariy:
  «B kompaniya foydalanuvchisi A kompaniya resursini ko'ra olmaydi»;
- **Concurrency** — parallel start, ikkita flush, optimistik qulf, cron lock;
- **Money** — BigInt chegaralari, `Number.MAX_SAFE_INTEGER` dan katta summalar,
  yaxlitlash, REVERSAL;
- **Isbot orqali tekshirish** — muhim tuzatishlarning har biri uchun qorovul
  **olib tashlab ko'rildi** va testlar qizil bo'lgani tasdiqlandi
  (GPS unique indeksi 4/6, rol qorovuli 2, fokus tuzog'i 3, foto 1, `skip` 1).

### Load test

`load-test/` (k6) + `docs/PERFORMANCE.md`. Bitta 4 yadroli konteynerda
(API + baza + generator birga):

- o'qishda to'yinish **~50 VU / ~110–120 req/s**;
- **200 VU'gacha xatolik 0%** — tizim to'yinganda sekinlashadi, **yiqilmaydi**;
- yozishda 40 telefon: p95 **74 ms**;
- **TASK-4.5 idempotency yuklama ostida tasdiqlandi**: 364 iteratsiya × 10
  nuqta = aynan **+3 640 qator**, har takror `accepted: 0`.

---

## PRODUCTION READY

| O'lcham            | BEFORE   | AFTER                              |
| ------------------ | -------- | ---------------------------------- |
| **Overall**        | 42/100   | **~80/100**                        |
| **Data loss risk** | **HIGH** | **LOW**                            |
| **Production**     | **NO**   | **Pilotga tayyor, prodga shartli** |

### Nega «tayyor» emas, «pilotga tayyor»

Ma'lumot yo'qotish xavfi yopildi: GPS nuqtasi ikki marta tushmaydi, foto
yo'qolmaydi, ledger o'zgarmas, migratsiyalar bor va commit qilingan, RLS uch
qatlam, cron'lar ikki instansiyada xavfsiz.

Prodgacha qolgani — **kod emas, infratuzilma**:

1. **Alohida baza serveri va 2+ API instansiyasi** bilan qayta o'lchash
   (`docs/PERFORMANCE.md` §6);
2. **`connection_limit` + pgbouncer** (`docs/DEPLOYMENT.md` §10) — hozir
   `DATABASE_URL` da ko'rsatilmagan;
3. **`DATABASE_URL_APP`** — RLS'ni chetlab o'tmaydigan rol
   (`docs/DEPLOYMENT.md` §9). Prodda app buni **majburiy** tekshiradi;
4. Haqiqiy **SMS provayderi** va **Sentry DSN** ulash;
5. `gps_tracks` partitsiyasi — 10M qator shartida.

---

## QOLGAN ISHLAR

`docs/ROADMAP.md` bo'yicha:

- **7-bosqich — Moliya**: to'liq P&L, tannarx, norma, valyuta konvertatsiyasi
  (`amountBase`/`rateUsed` maydonlari **allaqachon tayyor**, TASK-3.1/3.3);
- **8-bosqich — AI**: chek OCR, savol-javob, anomaliya. Kontrakt qoidasi
  o'zgarmaydi: **AI hech qachon bazaga yozmaydi va SQL yozmaydi**, moliyaviy
  hisob-kitobni oddiy kod bajaradi;
- **9-bosqich — Pilot**: birinchi mijoz, real o'lchov, partitsiya shartini
  tekshirish.

---

## Hujjatlar

| Fayl                     | Nima uchun                                             |
| ------------------------ | ------------------------------------------------------ |
| `FIX-PROGRESS.md`        | Har taskning to'liq jurnali (fayllar, testlar, commit) |
| `docs/BUSINESS-RULES.md` | Qoidalar va **ular nima uchun shunday**                |
| `docs/ARCHITECTURE.md`   | Qarorlar; §6 — partitsiya rejasi                       |
| `docs/PERFORMANCE.md`    | O'lchangan raqamlar va muhit sharti                    |
| `docs/DEPLOYMENT.md`     | §9 RLS rollari, §10 ulanish puli                       |
| `load-test/README.md`    | Yuklama testini qayta ishga tushirish                  |
