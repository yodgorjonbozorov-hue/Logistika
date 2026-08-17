# Xavfsizlik auditi (TZ §9)

> Sana: 2026-08-17. Qamrov: `apps/backend` (auth, tenant izolyatsiyasi, RBAC,
> audit-log, fayl saqlash), `docker-compose.prod.yml`, `deploy/`.
> Usul: kod bo'yicha statik ko'rib chiqish + mavjud testlar. Real bazali e2e
> testlar bu muhitda bajarilmadi (Docker demoni yo'q) — F-7 ga qarang.

Har bir topilma: nima, qanday tekshirildi, qanday oqibat, holati.

## Bu auditda tuzatilgani

### F-1 · Yuqori · Migratsiyalar yo'q edi

`apps/backend/prisma/migrations/` papkasi umuman bo'lmagan. Production
image `prisma migrate deploy` ni ishga tushiradi — u **nol** migratsiya
qo'llagan bo'lardi va bo'sh bazada ilova jadvalsiz ko'tarilardi. Ya'ni men
o'tgan qadamda yozgan deploy yo'li birinchi ishga tushirishdayoq sinardi.

**Tuzatildi:** `20260817000000_init` — sxemaning to'liq boshlang'ich
migratsiyasi (23 jadval, enum'lar, indekslar, tashqi kalitlar),
`prisma migrate diff --from-empty` orqali generatsiya qilindi.

> Bundan keyin sxema o'zgarsa, migratsiya ham commit qilinadi:
> `pnpm --filter backend prisma migrate dev --name <nima_ozgardi>`.

### F-2 · O'rta · O'g'irlangan refresh token qayta ishlatilishi aniqlanmasdi

Rotatsiya bor edi: yangi juftlik berilganda eski token bekor qilinardi.
Lekin bekor qilingan token qayta kelsa, faqat o'sha so'rov rad etilardi —
o'g'ri hali ham amaldagi juftlikni ushlab turishi mumkin edi.

**Tuzatildi:** bekor qilingan token qayta kelsa, shu foydalanuvchining
**barcha** sessiyalari yopiladi va audit-logga `REFRESH_REUSE` yoziladi.
Qaysi tomon o'g'ri ekanini bilishning iloji yo'q; sessiyani yo'qotish arzon,
o'g'irlangan sessiyani ochiq qoldirish esa qimmat.

### F-3 · O'rta · Login va SMS so'rovida chegara yo'q edi

Parol va olti xonali SMS kod — ikkalasi ham yetarli urinish bilan topiladi.
Kod bo'yicha 5 urinish chegarasi bor edi, lekin u faqat bitta kodga tegishli:
hech narsa hujumchiga yangi kod so'rashni taqiqlamasdi.

**Tuzatildi:** `@nestjs/throttler` — `login` va `driver/verify` uchun
daqiqasiga 10, `driver/request-code` uchun daqiqasiga 3 (SMS pul turadi).
Umumiy default daqiqasiga 300, ya'ni oddiy ishlashda sezilmaydi.

## Ochiq qolgani

### F-4 · Yuqori · RLS hujjatda bor, kodda yo'q

`docs/ARCHITECTURE.md` uch qatlamli himoyani va'da qilgan: `company_id`
filtri, Prisma extension va PostgreSQL Row-Level Security. Uchinchi qatlam
yozilmagan — na migratsiya, na siyosat (policy).

Amaldagi holat: izolyatsiya **Prisma extension** ga tayanadi
(`tenant.extension.ts`), uni ikki test qo'riqlaydi — modellar qamrovi va har
operatsiya uchun filtr qo'shilishi. Bu yaxshi qatlam, lekin bitta.

**Reja:** har tenant jadvaliga `ENABLE ROW LEVEL SECURITY` + `FORCE` va
`company_id = current_setting('app.company_id')::uuid` siyosati; `PrismaService`
har tranzaksiyada shu sozlamani o'rnatadi. Bu yerda bajarilmadi: sinab
ko'radigan baza yo'q, sinovsiz RLS esa butun ilovani qulflab qo'yishi mumkin.
Hujjatdagi da'vo shu holatga moslab tuzatildi — bajarilmagan narsa
bajarilgandek turmasin.

### F-5 · O'rta · Audit-log hamma o'zgarishni qamramaydi

TZ §9: «Barcha o'zgarishlar audit-log ga yoziladi». Hozir yoziladi:
`companies`, `users`, `auth`, `trips`, `expenses`, `events`.
Yozilmaydi: `vehicles`, `drivers`, `clients`, `fuel`, `maintenance`,
`documents`, `company/settings`, AI tasdiqlari.

Eng sezilarlisi — `fuel` va `company/settings`: yoqilg'i yozuvini yoki
chegarani jimgina o'zgartirib, nazoratni ma'nosiz qilib qo'yish mumkin.

**Reja:** yozuvchi servislarga `audit.log` qo'shish (interceptor emas —
o'zgarishning «oldin/keyin» qiymati faqat servisda ma'lum).

### F-6 · O'rta · Fayllar shifrlanmagan saqlanadi

TZ §9: «Fotolar va hujjatlar shifrlangan saqlash». `FilesService.putObject`
hech qanday shifrlash sarlavhasini yubormaydi, MinIO esa default holatda
shifrlamaydi. Chek va hujjat fotolari diskda ochiq yotadi.

**Reja:** pilot uchun eng amaliy yo'l — MinIO ma'lumot volume'ini LUKS
bilan shifrlangan diskda saqlash (bitta serverli o'rnatishda bu yetarli va
kalit boshqaruvini talab qilmaydi). Keyingi bosqich — SSE-S3 (MinIO KES bilan).
Ikkalasi ham `docs/DEPLOY.md` da yozilishi kerak.

### F-7 · O'rta · Real bazali izolyatsiya testlari yo'q

Har modul unit-testida tenant stsenariysi bor va extension qamrovi
tekshiriladi, lekin «B firma foydalanuvchisi A firma resursini ko'ra
olmaydi» stsenariysi haqiqiy PostgreSQL'da hech qachon bajarilmagan —
`test:e2e` konfiguratsiyasi bor, testlari yo'q.

**Reja:** `apps/backend/test/` da e2e paket: ikkita firma seed qilinadi va
har modulning `GET/PATCH/DELETE :id` uchun 404 kutiladi. CI'da postgres
service bilan ishlaydi.

### F-8 · Past · Ilova o'zi xavfsizlik sarlavhalarini qo'ymaydi

HSTS, `X-Content-Type-Options`, `X-Frame-Options` — hammasi nginx'da.
`docker-compose.prod.yml` bilan bu to'g'ri, lekin backend to'g'ridan-to'g'ri
ochilsa (masalan boshqa proksi ortida) sarlavhalar yo'qoladi.

**Reja:** `helmet` ni ilovaga qo'shish — nginx bilan ikkilanishi zarar qilmaydi.

### F-9 · Past · `@Roles` bo'lmasa — hamma autentifikatsiyadan o'tganga ruxsat

`RolesGuard` metadata bo'lmasa `true` qaytaradi. Ya'ni yangi kontroller
`@Roles` yozishni unutsa, u haydovchiga ham ochiq bo'ladi. Hozir bunday ikki
kontroller bor va ikkalasi ham ataylab: `auth` (ko'p yo'llari `@Public`) va
`files` (haydovchi foto yuklashi kerak; o'qish tenant bo'yicha chegaralangan).

**Reja:** guard'ni default-deny qilish va istisnolarni aniq belgilash.

## Tekshirilgan va joyida

| Nima                               | Dalil                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `company_id` hech qachon kirishdan | `body.companyId` / `query.companyId` bo'yicha qidiruv — nol natija; DTO'larda yo'q |
| Tenant filtri har operatsiyada     | `tenant.extension.spec.ts` + sxema-qamrov testi                                    |
| Parol saqlash                      | argon2, `me` javobida `passwordHash` yo'qligi test bilan                           |
| Refresh rotatsiyasi                | eski token yangi juftlik berilishi bilan bekor qilinadi (test bilan)               |
| AI chegaralari                     | `ai.boundaries.spec.ts` — bazaga yozmaydi, SQL yo'q, shaxsiy maydon promptda yo'q  |
| Mijoz tracking-havolasi            | muddatli token, javob sanitizatsiyasi test bilan (TZ §4.2)                         |
| Sirlar start'da tekshiriladi       | `config/env.validation.ts` — JWT sirlarisiz ilova ko'tarilmaydi                    |
| Tarmoq yuzasi                      | production compose'da faqat nginx port ochadi                                      |

## Keyingi audit uchun

Ustuvorlik tartibi: **F-4 (RLS) → F-7 (e2e izolyatsiya) → F-5 (audit-log) →
F-6 (shifrlash) → F-8, F-9**. F-4 va F-7 birga bajarilgani ma'qul: RLS ni
sinaydigan yagona ishonchli usul — real bazadagi izolyatsiya testi.
