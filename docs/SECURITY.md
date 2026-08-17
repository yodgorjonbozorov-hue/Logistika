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

## Qolgan topilmalar

### F-4 · Yuqori · RLS hujjatda bor, kodda yo'q edi — tuzatildi

`docs/ARCHITECTURE.md` uch qatlamli himoyani va'da qilgan: `company_id`
filtri, Prisma extension va PostgreSQL Row-Level Security. Uchinchi qatlam
yozilmagan edi — na migratsiya, na siyosat (policy). Oldingi auditda u ochiq
qoldirilgan edi: sinab ko'radigan baza yo'q edi, sinovsiz RLS esa butun
ilovani o'z ma'lumotidan qulflab qo'yishi mumkin.

**Tuzatildi.** Endi baza bor (mahalliy PostgreSQL 16) va qatlam yozilib,
tekshirildi:

- Migratsiya `20260818000000_rls` — `company_id` bor 21 jadvalga
  `ENABLE` + `FORCE ROW LEVEL SECURITY` va `tenant_isolation` siyosati.
  `FORCE` shart, chunki ilova jadvallarning egasi bo'lib ulanadi, ega esa
  majburlanmasa o'z siyosatidan ozod.
- Tenant tranzaksiya-lokal `app.company_id` sozlamasi orqali beriladi.
  `tenant.extension.ts` har operatsiyani ikki bosqichli batch tranzaksiyaga
  o'raydi: avval `set_config`, keyin so'rovning o'zi. Lokal bo'lgani uchun u
  pool'dagi ulanish orqali keyingi so'rovga o'tib ketmaydi — bu ham test bilan
  qo'riqlanadi.
- Sozlama **har model uchun** qo'yiladi, faqat `TENANT_MODELS` dagilar uchun
  emas. Sabab: `TENANT_MODELS` ga qo'shilmay qolgan model — aynan shu qatlam
  tutishi kerak bo'lgan xato.

**Ataylab qoldirilgan yo'l:** sozlama yo'q bo'lsa siyosat hech narsani
cheklamaydi. Kirish (telefon/email bo'yicha qidirish), tungi cron'lar (hamma
firmani aylanadi), ommaviy tracking-havola va seed — bularning hammasi tenant
ma'lum bo'lishidan oldin ishlaydi va yalang'och klientdan foydalanadi. Bu
qatlamning kuchini kamaytiradi, shuning uchun yashirilmayapti: RLS bu yerda
«ilova xato qildi» holatini tutadi, «ilova buzildi» holatini emas.

**Superuser haqida.** PostgreSQL superuser'ni (va `BYPASSRLS` rolini) siyosatdan
ozod qiladi — policy'lar `pg_policy` da turadi, o'rnatilgandek ko'rinadi va hech
nima qilmaydi. Shuning uchun:

- `docker-compose.prod.yml` endi ikki rol saqlaydi: `POSTGRES_USER` (superuser,
  administratsiya va zaxira uchun) va `APP_DB_USER` — ilova ulanadigan,
  `NOSUPERUSER NOBYPASSRLS` rol, u bazaning egasi (`deploy/postgres/10-app-role.sh`).
- Backend ko'tarilishda o'z rolini tekshiradi va ozod bo'lsa baland ovozda
  ogohlantiradi (`prisma.service.ts`) — bu nosozlik ilova ichidan ko'rinmaydi.
- Mavjud o'rnatmalar uchun bir martalik qadam `docs/DEPLOY.md` §9 da.

**Tekshiruv:** `apps/backend/test/rls.e2e-spec.ts` — ataylab **extension'siz**
yalang'och klient bilan, maxsus yaratilgan `NOSUPERUSER` rol ostida ishlaydi va
filtrsiz so'rov yuboradi: baza o'zi begona qatorni bermasligi, begona
`company_id` bilan yozishga ruxsat bermasligi (`WITH CHECK`), begona qatorni
`update`/`delete` qilmasligi, tenantsiz yo'l ochiq qolishi va sozlama keyingi
so'rovga o'tib ketmasligi tekshiriladi.

### F-5 · O'rta · Audit-log hamma o'zgarishni qamramasdi — tuzatildi

TZ §9: «Barcha o'zgarishlar audit-log ga yoziladi». Faqat `companies`,
`users`, `auth`, `trips`, `expenses`, `events` yozar edi. Eng sezilarli
bo'shliq — `fuel` va `company/settings`: yoqilg'i yozuvini yoki chegarani
jimgina o'zgartirib, nazoratning o'zini ma'nosiz qilib qo'yish mumkin edi.

**Tuzatildi:** `vehicles`, `drivers`, `clients`, `fuel`, `maintenance`,
`documents`, `company/settings` va Telegram ulanishi ham yozadi.
`AuditService.record()` yozuvni `auditSnapshot` orqali o'tkazadi: BigInt pul
va sanalar JSON'ga mos ko'rinishga keladi (aks holda audit yozuvi aynan
muhim qatorlarda sinardi), sirlar esa (`passwordHash`, `tokenHash`,
`telegramChatId`, `passport`) tashlab yuboriladi. Yangilashda faqat
o'zgargan maydonlar yoziladi.

Qoidani `audit.coverage.spec.ts` kod bo'yicha qo'riqlaydi: yozadigan har bir
servis yo audit qiladi, yoki sababi bilan istisnolar ro'yxatida turadi;
ro'yxatda endi yozmaydigan fayl qolsa, test buni ham aytadi.

### F-6 · O'rta · Fayllar shifrlanmagan saqlanadi — o'rnatish qatlamida yopildi

TZ §9: «Fotolar va hujjatlar shifrlangan saqlash». `FilesService.putObject`
hech qanday shifrlash sarlavhasini yubormaydi, MinIO esa default holatda
shifrlamaydi.

**Qabul qilingan yechim:** shifrlash ilova qatlamida emas, **disk qatlamida** —
LUKS. Bitta serverli o'rnatish uchun bu SSE-C dan afzal: kalit boshqaruvi
kerak emas, o'qish yo'llari o'zgarmaydi va disk o'g'irlansa ham ma'lumot
o'qilmaydi. Qadamlar `docs/DEPLOY.md` §6 da, zaxira nusxa uchun ham.

Bu ilova kodida hech narsa o'zgarmaganini bilib turib qabul qilingan qaror:
o'rnatuvchi bu qadamni o'tkazib yuborsa, fayllar ochiq qoladi. Shuning uchun u
DEPLOY.md da alohida bo'lim, ixtiyoriy eslatma emas. Bulutli o'rnatishda
keyingi qadam — SSE-S3 (MinIO KES).

### F-7 · O'rta · Real bazali izolyatsiya testlari yo'q edi — yozildi

Har modul unit-testida tenant stsenariysi bor edi, lekin «B firma
foydalanuvchisi A firma resursini ko'ra olmaydi» haqiqiy PostgreSQL'da hech
qachon bajarilmagan: `test:e2e` konfiguratsiyasi bor, testlari yo'q edi.

**Yozildi:** `apps/backend/test/tenant-isolation.e2e-spec.ts` — ikkita firma
seed qilinadi, B foydalanuvchisi A ning mashina/haydovchi/mijoz/reysini
`GET` va `PATCH` qiladi (hammasi 404), A ning chatini ochmoqchi bo'ladi, A ning
reysiga xarajat biriktirmoqchi bo'ladi; oxirida A ning yozuvlari
o'zgarmaganligi bazadan tekshiriladi. CI (`.github/workflows/ci.yml`) postgres
service ko'taradi va shu yerda `prisma migrate deploy` ni ham bajaradi — ya'ni
migratsiya buzilgani deploy kunida emas, PR'da bilinadi.

Endi ular haqiqatan bajarildi: muhitga PostgreSQL 16 mahalliy ko'tarilib,
`prisma migrate deploy` va ikkala e2e paketi ishga tushirildi. Birinchi
yugurishdayoq ular haqiqiy teshik topdi — pastdagi **F-10**. Ya'ni bu testlar
bezak emas.

### F-8 · Past · Ilova o'zi xavfsizlik sarlavhalarini qo'ymasdi — tuzatildi

HSTS, `X-Content-Type-Options`, `X-Frame-Options` faqat nginx'da edi.
`docker-compose.prod.yml` bilan bu to'g'ri, lekin backend boshqa proksi ortida
ochilsa sarlavhalar yo'qolardi.

**Tuzatildi:** `helmet` ilovaning o'zida. CSP o'chirilgan — API JSON qaytaradi,
CSP esa panel (nginx) tomonida ma'noga ega.

### F-9 · Past · `@Roles` bo'lmasa hammaga ruxsat edi — tuzatildi

`RolesGuard` metadata bo'lmasa `true` qaytarardi: yangi kontroller `@Roles`
yozishni unutsa, u haydovchiga ham ochiq bo'lardi.

**Tuzatildi:** guard endi default-deny. Rol e'lon qilmagan yo'l rad etiladi,
`@Public` esa avvalgidek o'tadi. Ataylab hammaga ochiq ikki joy endi buni
aniq yozadi: `files` (haydovchi chek fotosini yuklaydi) va `GET /auth/me` —
`@Roles(...ANY_ROLE)`. Kontroller darajasidagi qamrov test bilan
qo'riqlanadi: `@Public` bo'lmagan har yo'lda `@Roles` bo'lishi shart.

### F-10 · Yuqori · Tashqi kalit tenant chegarasidan o'tib ketardi — tuzatildi

Izolyatsiya paketi birinchi marta real bazada ishlaganda `POST /expenses`
B firmasiga A firmasining `tripId` si bilan **201** qaytardi.

Yozuv B ning tenantida tug'iladi (extension `company_id` ni to'g'ri qo'yadi),
lekin uning tashqi kaliti A ga qaraydi. Keyin A o'z reysining P&L sini
so'raganda Prisma `expenses` relatsiyasi orqali begona qatorni ham qo'shib
beradi: birovning xarajati A ning foydasini kamaytiradi. Tenant extension buni
tuta olmasdi — `create` da u faqat yangi qatorga `company_id` bosadi, body'dan
kelgan `tripId` ni tekshirmaydi.

Bir joyda emas, bir sinfda muammo edi: `expenses` (xarajat va kirim, create va
update), `fuel` (`tripId`, `driverId` — `vehicleId` tekshirilardi).

**Tuzatildi:** `src/common/tenant-refs.ts` — `assertRefsInCompany(db, refs)`.
Har `tripId`/`vehicleId`/`trailerId`/`driverId`/`clientId` yozishdan oldin
tenant-klient orqali qidiriladi; begona id yo'q id bilan bir xil 404 oladi
(F-3 dagi qoida). `trips.service` ning o'z tekshiruvi shu umumiy funksiyaga
ko'chirildi, ya'ni qoida bitta joyda yashaydi. Qamrov: `tenant-refs.spec.ts`
va izolyatsiya e2e'sida to'rt yangi stsenariy (xarajat, kirim, yoqilg'i, reys).

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
| Body'dagi begona id                | `tenant-refs.spec.ts` + izolyatsiya e2e'si (F-10)                                  |
| Baza qatlamidagi izolyatsiya       | `rls.e2e-spec.ts` — extension'siz, `NOSUPERUSER` rol ostida (F-4)                  |

## Keyingi audit uchun

Ochiq topilma qolmadi. Uchala izolyatsiya qatlami ham amalda va uchala e2e
paketi real bazada ishlaydi.

Keyingi audit nimalarga qarasin:

1. **RLS'ning ataylab qoldirilgan yo'li.** Sozlama yo'q bo'lsa siyosat
   cheklamaydi (F-4). Ya'ni yalang'och klientdan foydalanadigan kod — kirish,
   cron, seed — hamon ishonchga tayanadi. Buni toraytirishning yo'li:
   so'rov ishlovchi kod yalang'och klientni ishlatmasligini test bilan
   qo'riqlash (`audit.coverage.spec.ts` uslubida).
2. **F-10 ning saboqi.** Tenant qatlami yozuvning **egasini** kafolatlaydi,
   uning **havolalarini** emas — RLS ham `expenses.trip_id` begona reysga
   qarashini o'zi to'xtatmaydi. Shuning uchun `assertRefsInCompany` RLS
   kelgandan keyin ham kerak; u olib tashlanmaydi.
3. **Ishlash.** Har so'rov endi ikki bosqichli tranzaksiya. 5–40 texnikali
   firma uchun bu sezilmaydi, lekin pilotda `pg_stat_statements` bilan
   o'lchash kerak.
