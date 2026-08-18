# Biznes qoidalari

Bu hujjat pul va reys bilan bog'liq qarorlarni bir joyda saqlaydi: kodda nima
qilinganini va **nima uchun** shundayligini. Har qaror TASK raqami bilan bog'langan.

## 1. Ledger — mijoz qarzi (TASK-3.1)

### Nega ledger

`Client.balance` ustuni bor edi, lekin unga **hech qachon hech narsa yozilmasdi**, va
`payment_terms_days` o'lik maydon edi. Ya'ni logistika biznesining asosiy savoli —
«bu mijoz qancha qarzdor?» — tizimda javobsiz edi.

### Model

`ledger_entries` — **o'zgarmas** (immutable) pul harakatlari jurnali.
Yozuv hech qachon tahrirlanmaydi va o'chirilmaydi (DB trigger bilan taqiqlangan);
xato **REVERSAL** yozuvi bilan tuzatiladi. Sabab: bir necha oydan keyin
«o'shanda qancha deb hisoblagan edik?» degan savolga javob bera olish kerak.

### Yo'nalish (direction) — firma nuqtai nazaridan

| Direction | Ma'nosi                          | Misol                    |
| --------- | -------------------------------- | ------------------------ |
| `DEBIT`   | Mijoz **ko'proq qarzdor** bo'ldi | Reys yakunlandi → invoys |
| `CREDIT`  | Mijoz **qarzini qopladi**        | To'lov keldi             |

```
balance = SUM(CREDIT) - SUM(DEBIT)      // manfiy = mijoz qarzdor
debt    = balance < 0 ? -balance : 0    // odam so'raydigan raqam
```

API ikkalasini ham qaytaradi: `balance` — buxgalteriya belgisi bilan, `debt` — «qancha
qarzdor» degan savolga to'g'ridan-to'g'ri javob. Ortiqcha to'lov `debt = 0` va musbat
`balance` bo'ladi (manfiy qarz emas — bu chalkash).

### Qachon yoziladi

| Hodisa                     | Yozuv                                     |
| -------------------------- | ----------------------------------------- |
| Reys `COMPLETED` bo'ldi    | `DEBIT` / `TRIP_INVOICED` (`agreedPrice`) |
| Kirim (`Income`) yaratildi | `CREDIT` / `PAYMENT_RECEIVED`             |
| To'lov summasi tuzatildi   | `REVERSAL` + yangi `CREDIT`               |

Reysni **ikki yo'l** yakunlaydi: logist (`POST /trips/:id/complete`) va haydovchi
(`FINISH` hodisasi). Ikkalasi ham bitta invoys yaratishi kerak — shuning uchun
`invoiceCompletedTrip()` avval mavjud yozuvni tekshiradi (idempotent).

### `Client.balance` — kesh

Balans **agregatsiyadan** olinadi (`GET /clients/:id/balance` `ledger_entries`ni
sanaydi). `Client.balance` ustuni ro'yxat ekranlari uchun kesh sifatida qoladi va
**faqat** yozuv bilan bitta tranzaksiyada, **atomik `increment`** bilan yangilanadi —
read-modify-write emas (DB-5: ikki parallel to'lov bir-birining hisobini o'chirib
yuborardi).

> **Qaror:** ustunni butunlay olib tashlash o'rniga kesh sifatida qoldirildi —
> mijozlar ro'yxatida har qator uchun agregatsiya qilish 40 mashinali firmada ham
> keraksiz yuk. Kesh va agregatsiya mos kelishi e2e testda tekshiriladi.

### Kechikkan qarz (overdue)

To'lovlar **eng eski invoysdan** boshlab yopiladi (odatiy konventsiya). `overdue` —
muddati (`paymentTermsDays`) o'tgan, hali yopilmagan invoyslar yig'indisi.
`paymentTermsDays` kelishilmagan bo'lsa hech narsa kechikkan hisoblanmaydi.

### `Income.status` endi hisoblanadi

Avval bu erkin yoziladigan maydon edi — moliya sahifasida bitta `<Select>` bilan
to'lanmagan reysni `PAID` deb belgilash mumkin edi va tizimda hech narsa e'tiroz
bildirmasdi. Endi:

- DTO'dan olib tashlandi (klient yuborsa e'tiborsiz qoldiriladi);
- ledger'dan hisoblanadi: reys invoysi to'liq qoplansa `PAID`, qisman bo'lsa `PARTIAL`;
- web'da faqat `Badge` (o'zgartirib bo'lmaydi).

### Manfiy summa yo'q

`amount` doim musbat. Teskari harakat — qarama-qarshi `direction` yoki `REVERSAL`.
Sabab: manfiy summa har bir `SUM()` ni ikki xil o'qishga imkon beradi (L-8).

## 2. Idempotency — pul so'rovlari (TASK-3.2)

### Muammo

`Idempotency-Key` ham, unique constraint ham yo'q edi. 1 000 000 so'm ikki marta
yuborilsa — ikkita yozuv. Bu nazariy emas: mobil ilova javob kelmagan so'rovni qayta
uradi, formada esa ikki marta bosish odatiy hol.

### Qanday ishlaydi

1. Klient `Idempotency-Key` header yuboradi (web'da har mutatsiya uchun bitta UUID,
   **retry'da o'zgarmaydi** — TanStack Query bir xil `variables` obyektini uzatadi,
   kalit shu obyektga bog'langan).
2. Server kalitni **avval band qiladi** (`statusCode = 0` bilan qator yaratadi),
   keyin ishni bajaradi. Tekshirib-keyin-yozish ikki bir vaqtdagi so'rov uchun
   teshik qoldirardi — aynan double-click holati.
3. Ish tugagach javob saqlanadi; o'sha kalit bilan kelgan takroriy so'rov **saqlangan
   javobni** oladi (bir xil `id`).
4. Ish xato bersa kalit **bo'shatiladi** — klient payload'ni tuzatib o'sha kalit bilan
   qayta yuboradi.

| Holat                                   | Natija                              |
| --------------------------------------- | ----------------------------------- |
| Kalit yo'q                              | 400 `VALIDATION_FAILED`             |
| O'sha kalit, o'sha payload              | Saqlangan javob (yangi yozuv yo'q)  |
| O'sha kalit, **boshqa** payload         | 409 `IDEMPOTENCY_KEY_REUSED`        |
| O'sha kalit, birinchisi hali ishlayapti | 5 s kutadi, keyin javobni qaytaradi |
| Boshqa kompaniya, o'sha kalit           | Mustaqil (kalit `(companyId, key)`) |

### Qayerda majburiy

`POST /expenses`, `POST /incomes`, `POST /trips`, `POST /trips/:id/complete`,
`POST /expenses/:id/approve`.

`POST /events/batch` bu ro'yxatda **yo'q** — unda o'z idempotency mexanizmi bor
(`clientEventId`, TZ §3.1), va mobil navbat aynan shuni saqlaydi.

Kalitlar 24 soatdan keyin kunlik job bilan tozalanadi.

## 3. Valyuta (TASK-3.3)

### Muammo

`Currency{UZS,USD,RUB,KZT}` har money jadvalida bor edi, lekin **kurs jadvali ham,
konvertatsiya kodi ham yo'q**. Ya'ni hisobot USD tiyinini UZS tiyiniga qo'shib,
ma'nosiz raqam chiqarardi.

### Qoidalar

- **Baza valyuta — UZS tiyin.** Har money yozuvida `amountBase` (UZS tiyin) bor va
  **barcha agregatsiya faqat shu maydon bo'yicha** bajariladi.
- `ExchangeRate` — `(currency, date)` unique, `rateToUzs` `Decimal(18,6)`, `source`.
  Kompaniyalar orasida **umumiy** (kurs tenant ma'lumoti emas).
- `rateToUzs` — **bitta birlik** uchun UZS (masalan 1 USD = 12500 UZS). Enum'dagi
  hamma valyuta 100 mayda birlikka bo'linadi, shuning uchun konvertatsiya oddiy
  ko'paytirish: `tiyin = amount_minor × rateToUzs` (bo'lish yo'q → birlik yo'qolmaydi).
- Yaxlitlash: `Decimal` bilan, **ROUND_HALF_UP**, butun tiyingacha. JS `number`
  ishlatilmaydi.
- **Qotirilgan (frozen)**: `amountBase`, `rateUsed`, `rateDate` yozuv yaratilganda
  hisoblanadi va keyin **o'zgarmaydi**. Kurs ertaga o'zgarsa, o'tgan oy hisoboti
  o'zgarmaydi.
- UZS uchun `rateUsed = NULL` (kurs `1` emas): konvertatsiya **bo'lmagani**ni
  bildiradi.
- Kurs topilmasa — `EXCHANGE_RATE_MISSING` (422) va yozuv **yaratilmaydi**.
  Taxminiy kurs ishlatilmaydi: taxmin bilan qurilgan hisobot qurilmagan hisobotdan
  yomonroq, chunki keyin qaysi raqam taxmin ekanini hech kim ajrata olmaydi.
- Dam olish kunlari: so'ralgan sanaga kurs bo'lmasa, **undan oldingi eng yaqin**
  kurs ishlatiladi (juma kursi shanba-yakshanbaga ham amal qiladi).

### Kurs kiritish

`POST /admin/exchange-rates` (SUPERADMIN, kuniga bitta yozuv — takroriy POST o'sha
kunni yangilaydi). `source` maydoni manbani saqlaydi (`manual`, keyinchalik `cbu.uz`).
CBU.uz'dan kunlik olish uchun `CurrencyService.upsertRate()` tayyor — job qo'shilishi
kifoya.

### Mavjud ma'lumot

Migratsiya `amount_base = amount` qilib to'ldirdi va `rate_used`ni `NULL` qoldirdi:
bu paytgacha yozilgan hamma summa UZS edi (UI faqat UZS taklif qilardi, `currency`
default'i ham UZS).

## 4. Reys yakuni va uning moliyaviy ma'nosi (TASK-3.4)

### Muammo

`TRANSITIONS.IN_PROGRESS = ['COMPLETED']` edi — ya'ni yo'lda buzilgan yoki mijoz rad
etgan reysni **faqat «yakunlangan»** deb yozish mumkin edi. Natijada bo'lmagan ish
daromadga tushardi va moliyaviy hisobot aynan hech kim tekshirmaydigan tomonga
qarab buzilardi.

### Statuslar va o'tishlar

```
DRAFT       → ASSIGNED | CANCELLED
ASSIGNED    → IN_PROGRESS | DRAFT | CANCELLED
IN_PROGRESS → COMPLETED | PARTIALLY_DELIVERED | RETURNED | FAILED | CANCELLED
COMPLETED / PARTIALLY_DELIVERED / RETURNED / FAILED / CANCELLED → terminal
```

### Har statusning moliyaviy qoidasi

| Status                | Invoys                                                            | Xarajatlar     |
| --------------------- | ----------------------------------------------------------------- | -------------- |
| `COMPLETED`           | To'liq `agreedPrice`                                              | Qoladi         |
| `PARTIALLY_DELIVERED` | Faqat `deliveredAmount`                                           | Qoladi         |
| `RETURNED`            | **Yo'q**                                                          | Qoladi (zarar) |
| `FAILED`              | **Yo'q**                                                          | Qoladi (zarar) |
| `CANCELLED`           | Yo'q; avans berilgan bo'lsa — qaytarish yozuvi (`DRIVER_ADVANCE`) | Qoladi         |

Zararni yashirmaslik ataylab: RETURNED/FAILED reysning xarajatlari o'chirilmaydi,
chunki ular haqiqatan sarflangan. Hisobotda bu reys zarar bo'lib ko'rinadi — bu
to'g'ri tasvir.

### Sabab majburiy

`PARTIALLY_DELIVERED`, `RETURNED`, `FAILED` uchun `reason` (`@MinLength(10)`) shart.
`«x»` degan izoh izohsizlik bilan bir xil: bir necha hafta o'tib zarar ko'rilgan oyni
ko'rib chiqayotgan odam uchun hech narsa bermaydi. `statusReason` va `statusChangedAt`
reysda saqlanadi.

`POST /trips/:id/finish` — OWNER/LOGIST, idempotent.

## 5. Bir vaqtda kelgan yozuvlar — kim yutadi (TASK-3.5)

### Muammo

Har bir muhim yozuv «o'qi → qaror qil → yoz» edi:

```ts
const trip = await db.trip.findUnique({ where: { id } });
assertTripTransition(trip.status, 'COMPLETED'); // ← o'qish va yozish orasidagi bo'shliq
await db.trip.update({ where: { id }, data: { status: 'COMPLETED' } });
```

Ikki so'rov birga kelsa (logist tugmani bosdi, haydovchi ilovasi ham `FINISH`
hodisasini yubordi) ikkalasi ham bir xil `IN_PROGRESS`ni o'qiydi, ikkalasi ham
o'tishni qonuniy deb topadi va ikkalasi ham yozadi. Natija: `finishedAt` qayta
yozildi, `actualDistanceKm` qayta hisoblandi va TASK-3.1 dan keyin **mijoz bitta
yetkazib berish uchun ikki marta hisob-kitob qilindi**.

### Qoida

Qaror **yozuvning `WHERE` shartiga** kiritiladi, shundan keyingina yozish bajariladi:

```ts
const { count } = await tx.trip.updateMany({
  where: { id, status: trip.status },              // kutilgan holat shart ichida
  data:  { status, version: { increment: 1 } },
});
if (count === 0) throw new AppException('TRIP_INVALID_STATUS', 409, …);
```

Ikki parallel so'rovdan **aynan bittasi** qatorga mos keladi. Yutqazgan so'rov
409 oladi va **hech narsa yozmaydi** — guard tranzaksiya ichida va invoyslashdan
oldin turgani uchun ledger ham tegilmaydi.

### `version` ustuni

`Trip`, `Expense`, `Income`da `version Int @default(0)`. Har himoyalangan yozuv
uni bittaga oshiradi. Ikki vazifasi bor:

- **ichki** — servis o'zi o'qigan versiyaga qarshi yozadi (klient hech narsa
  yubormasa ham poyga yopiladi);
- **tashqi** — klient ko'rgan versiyani `PATCH` bilan yuborishi mumkin
  (`{ ..., version: 7 }`). Qator o'shandan keyin o'zgargan bo'lsa —
  409 `RESOURCE_CONFLICT`, ya'ni «sen ko'rmagan o'zgarishni ustidan yozmaysan».

`version` — faqat qulf belgisi; uni klient o'zi tanlab qo'ya olmaydi
(`data`ga har doim `{ increment: 1 }` yoziladi).

### Qayerda qo'llangan

| Amal                                                       | Guard                               | Nega                                                            |
| ---------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| `trips.transition()` (start/complete/finish/cancel/assign) | `status` = kutilgan                 | ikki marta invoyslash                                           |
| `trips.update()`                                           | klient yuborgan `version`           | ikki logist bir reysni tahrirlaydi                              |
| `expenses.approveExpense()`                                | `isApproved: false`                 | bitta tasdiqlash — ikkita audit yozuvi                          |
| `expenses.updateExpense()`                                 | `isApproved: false` + `version`     | tasdiqlangan xarajat jimgina tahrirlanardi                      |
| `expenses.removeExpense()`                                 | `deleteMany({ isApproved: false })` | tasdiqlangan xarajat moliyaviy yozuvdan yo'qolardi              |
| `expenses.updateIncome()`                                  | `version`                           | ikki tuzatish bir ledger yozuvini ikki marta `REVERSAL` qilardi |

### Klient tomoni

409 kelganda web avtomatik `invalidateQueries` qiladi (`onConflictRefetch`) —
ekrandagi eskirgan nusxa darhol yangilanadi. Xabar backend'dan keladi
(`RESOURCE_CONFLICT`, uch tilda): «Ma'lumot boshqa foydalanuvchi tomonidan
o'zgartirildi. Sahifani yangilang va qayta urinib ko'ring».

### Test

Bunday xatoni faqat haqiqiy parallel test ushlaydi — ketma-ket test buzuq kodda
ham yashil bo'ladi. `test/optimistic-locking.e2e-spec.ts` `Promise.all` bilan
ikkitadan so'rov yuboradi va `[200, 409]` hamda **bitta** ledger yozuvini talab
qiladi.

## 6. Qiymat cheklovlari — spidometr va manfiy son (TASK-3.6)

### Spidometr faqat oldinga yuradi

`end_odometer < start_odometer` — bu yozuv xatosi (411 518 o'rniga 411 158).
Ayirma **manfiy masofa** beradi va uning ustiga qurilgan hamma narsani jimgina
buzadi: yoqilg'i normasi (100 km ga litr), km tannarxi, reys foydasi. Hech kim
sezmaydi, chunki hisobot o'zini tug'dirgan ko'rsatkichni ko'rsatmaydi.

Qoida `common/odometer.ts`da — **bitta joyda**, chunki logist yo'li
(`trips.service`) va haydovchi yo'li (`events.service`) bir xil qatorni
o'zgartiradi va nima to'g'ri ekanida kelisha olishi shart:

| Holat          | Natija                                                  |
| -------------- | ------------------------------------------------------- |
| `end >= start` | masofa = `end − start` (0 km ham haqiqiy qiymat)        |
| `end < start`  | 400 `ODOMETER_INVALID`, ikkala ko'rsatkich xabar ichida |
| biri `NULL`    | qabul qilinadi, masofa yozilmaydi                       |

**Yo'q ma'lumot — noto'g'ri ma'lumot emas.** Reys ko'rsatkich yozilmasdan
ham yakunlanishi mumkin; buni bloklash yig'ilmagan ma'lumot uchun ishni
to'xtatish bo'lardi.

Haydovchi paketida (`/events/batch`) bunday `FINISH` **rad etiladi** va hodisa
umuman saqlanmaydi. Avval u qabul qilinardi, masofa esa jimgina bo'sh qolardi:
reys «tugagan» ko'rinardi va har qanday km-hisobotidan tushib qolardi.
Mobil ilova bunday rad etishni darhol «e'tibor talab qiladi» ro'yxatiga
qo'yadi (`permanentRejections`) — o'sha noto'g'ri raqamni qayta yuborish
hech qachon o'tmaydi, 2 soat kutish esa faqat haydovchining xabar topishini
kechiktiradi.

### DB darajasidagi CHECK cheklovlari

Ilova validatsiyasi — foydalanuvchi tushunarli xabar oladigan joy, lekin
**kafolat u yerda yashamaydi**: seed skripti, avariya paytidagi qo'lda
`UPDATE`, import job'i yoki kelajakdagi tekshiruvni unutgan endpoint jadvalga
to'g'ridan-to'g'ri boradi. Manfiy bo'lib qolgan pul oylar keyin, hech kim
solishtira olmaydigan hisobotda topiladi.

| Jadval           | Cheklov                                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trips`          | `end_odometer >= start_odometer`; odometr/masofa ≥ 0; `agreed_price`, `driver_advance`, `delivered_amount` ≥ 0; `delivered_amount <= agreed_price` |
| `expenses`       | `amount`, `amount_base`, `unit_price`, `quantity` ≥ 0                                                                                              |
| `incomes`        | `amount`, `amount_base` ≥ 0                                                                                                                        |
| `fuel_logs`      | `liters > 0`; narx/summa/odometr ≥ 0                                                                                                               |
| `ledger_entries` | `amount`, `amount_base` ≥ 0 — **ishorani `direction` tashiydi**                                                                                    |
| `exchange_rates` | `rate_to_uzs > 0`                                                                                                                                  |

Har bir cheklov `NULL`ni o'tkazadi: bu ustunlarning ko'pi qonuniy ravishda
ixtiyoriy. Migratsiya `20260817190000_value_check_constraints`; yozishdan oldin
mavjud qatorlar tekshirildi — hech biri buzmaydi.

Test ikkala qatlamni ham tekshiradi: API rad etishini va **Prisma orqali
to'g'ridan-to'g'ri yozishni** (`test/value-constraints.e2e-spec.ts`) — ya'ni
ilova chetlab o'tilganda ham baza rad etadi.

## 7. Reys raqami (TASK-3.7)

### Muammo

`trip_number` `count() + 1` edi. Ikki xil buziladi:

- **takrorlanadi** — reys o'chirilsa bo'shagan raqamni keyingisi oladi, ya'ni
  ikki xil reys hujjatda bir xil raqam bilan yuradi (raqam aynan shuning
  uchun bor);
- **poyga qiladi** — bir soniyada ikki yaratish bir xil `count()`ni o'qiydi va
  bir xil raqamni so'raydi. Atrofidagi retry sikli uch marta urinib, keyin
  xom unique-constraint xatosini foydalanuvchiga uzatardi.

### Yechim

`trip_counters` — `(company_id, year)` kalitli hisoblagich. Sanalmaydi,
**oshiriladi**:

```sql
INSERT INTO trip_counters … ON CONFLICT (company_id, year)
DO UPDATE SET last_number = trip_counters.last_number + 1
```

Oshirish qatorni tranzaksiya oxirigacha qulflaydi, shuning uchun ikkinchi
yaratuvchi navbatda kutadi va keyingi raqamni oladi. Raqam va reysning o'zi
**bitta tranzaksiyada** olinadi.

**Bo'shliq (gap) qabul qilinadi.** Raqam olib, keyin yiqilgan tranzaksiya
bitta raqamni ishlatilmagan qoldiradi. Bo'shliq — hech kim ishlatmagan raqam;
takror — o'zini bitta deb da'vo qilayotgan ikki reys. Faqat ikkinchisi muammo.

### Format

`TR-2026-0042` — yil kalitning bir qismi, shuning uchun ketma-ketlik har
yanvarda qaytadan boshlanadi va abadiy o'smaydi. Ketma-ketlik 4 xonagacha
to'ldiriladi (`0009` `0010` dan oldin turadi — matn sifatida ham to'g'ri
saralanadi), undan oshsa kesilmaydi (`TR-2026-12345`).

Yil **UTC** bo'yicha olinadi: reys qaysi yilga tegishli ekani server qaysi
timezone'da ishlayotganiga bog'liq bo'lmasligi kerak.

Raqam endi o'zini o'zi tanitadi, shuning uchun web'dagi qo'shimcha `№`
prefiksi olib tashlandi (`№TR-2026-0001` emas, `TR-2026-0001`).

### Mavjud ma'lumot

Migratsiya har kompaniya va yil uchun hisoblagichni mavjud reyslar soni bilan
to'ldiradi, shuning uchun birinchi yangi raqam ketma-ketlikni **davom
ettiradi**, allaqachon ishlatilgan raqam bilan to'qnashmaydi.
`trip_counters` ham `tenant_isolation` RLS siyosatini oladi: hisoblagich
kompaniya qancha reys qilishini aytadi — bu raqobatchi ko'rmoqchi bo'lgan aynan
o'sha raqam.

## 8. Offline sinxronizatsiya idempotentligi (TASK-3.8)

### Muammo

Har haydovchi hodisasi klient yaratgan UUID (`clientEventId`) bilan keladi —
tunnelda tarmoqni yo'qotgan telefon xuddi shu paketni qayta yuborishi va
hodisa **ikki marta yozilmasligi** uchun. Tekshiruv esa `findMany` → keyin
`create` edi:

```ts
const existing = await db.tripEvent.findMany({ where: { clientEventId: { in: ids } } });
// ← ikkita paket shu yerda ikkalasi ham «yo'q» deb topadi
await tx.tripEvent.create({ … });
```

Ikki paket birga kelsa (ilova navbatni tozalaydi, ayni paytda ulanish
kuzatuvchisi ham ishga tushadi) ikkalasi ham yozishga urinadi.

Unique indeks ikkinchi yozuvni to'xtatardi, lekin uning xatosini **hech kim
ushlamasdi** — butun paket 500 bilan yiqilardi. Ilova esa aynan kerakli ishni
qilib, o'sha paketni cheksiz qayta yuborardi.

### Qoida

**Dublikat — bu yozuvning o'zi rad etgan narsa, oldindan o'qilgan emas.**
`findMany` qoldi, lekin u faqat arzon birinchi filtr: oldingi paket saqlagan
id'lar uchun ishni o'tkazib yuboradi. Kafolatni unique indeks beradi:

| Natija                      | Ma'nosi                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| yozildi                     | `accepted`                                                                                          |
| `P2002` (`client_event_id`) | `duplicates` — poygada yutqazdi, hodisa allaqachon bor                                              |
| boshqa har qanday xato      | ko'tariladi — «allaqachon yuborilgan» degan tinchlantiruvchi so'z ostida haqiqiy xatoni yashirmaydi |

`P2002` tekshiruvi ataylab **tor**: faqat `client_event_id` bo'yicha. Boshqa
unique buzilishi haqiqiy bug va ko'rinishda qolishi kerak. Tarmoq uzilishi ham
dublikat emas — uni dublikat deb hisoblash telefonni server saqlamagan
hodisani o'chirishga majbur qilardi.

### Kalitning o'zi

Ikki narsa noto'g'ri edi:

- **`NULL` bo'lishi mumkin edi.** Bo'lishi shart bo'lmagan kalit hech narsani
  deduplikatsiya qilmaydi, PostgreSQL esa har `NULL`ni alohida deb biladi —
  ya'ni bunday qatorlar umuman himoyasiz edi. DTO uni har doim talab qilgan,
  shuning uchun bu faqat API qabul qiladigan narsa bilan jadval ruxsat
  beradigan narsa orasidagi bo'shliqni yopadi.
- **Global unique edi.** Bir tenant'ning id'lari boshqasi nima saqlashi
  mumkinligini hal qilardi: boshqa kompaniyaga tegishli id'ni bilib olgan
  haydovchi o'z hodisasini «allaqachon ko'rilgan» deb rad ettirishi mumkin
  edi. Endi `@@unique([companyId, clientEventId])` — har boshqa tenant kaliti
  kabi.

Migratsiya `20260818070000_event_idempotency_key`: `NULL` kalitlar generatsiya
qilingan UUID bilan to'ldiriladi (hech bir telefon navbatiga mos kelmaydi,
ya'ni ular allaqachon qanday bo'lsa shunday qoladi), kompaniyalar orasidagi
takroriy kalitlar ham qayta yoziladi, keyin `NOT NULL` va yangi indeks.

## 9. Obuna va kompaniya holati (TASK-3.9)

### Muammo

`Company.isActive` va `subscriptionUntil` birinchi migratsiyadan beri bor va
SUPERADMIN ularni to'ldiradi, lekin **hech kim o'qimasdi**. To'lashni to'xtatgan
— yoki butunlay o'chirilgan — kompaniya mahsulotning har bir endpoint'idan
to'liq foydalanaverardi.

### Ikki holat, ataylab har xil javob

| Holat                                      | Javob                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `isActive = false` — kompaniya o'chirilgan | **Hech narsa mumkin emas** (403 `COMPANY_INACTIVE`). Bu ma'muriy qaror, to'lov holati emas. |
| `subscriptionUntil` o'tib ketgan           | **O'qish ishlaydi, yozish yo'q** (402 `SUBSCRIPTION_EXPIRED`).                              |
| `subscriptionUntil = NULL`                 | Muddat qo'yilmagan — sinov davri yoki eski tenant. Cheklov yo'q.                            |

Muddati o'tgan kompaniyani o'z ma'lumotidan butunlay uzish — **jazo, undiruv
emas**: firma o'z reyslarini ocholmaydi, kimdan qancha olishini ko'rolmaydi va
yozuvlarini eksport qilolmaydi. To'xtaydigan narsa — pul to'lanmayotgan tizimga
**yangi** ma'lumot yozish.

`GET`/`HEAD`/`OPTIONS` — o'qish, qolgani yozish.

### Chetda qoladiganlar

- **SUPERADMIN** — obunani aynan o'sha hisob tuzatadi.
- **`@Public()` marshrutlar** — muddati o'tgan kompaniya kira olmasa, nima
  uchun muddati o'tganini hech qachon bilmaydi.

### Ogohlantirish

O'qish o'tib ketgani uchun javob buni **aytishi kerak**, aks holda ofis hamma
narsa odatdagidek yuklanayotganini ko'radi va muammoni faqat birinchi saqlash
yiqilganda biladi:

```json
{ "success": true, "data": [...], "error": null,
  "meta": { "subscription": { "expired": true, "until": "2026-07-31T00:00:00.000Z" } } }
```

### Kesh

Tekshiruv **har bir so'rovda** kerak, shuning uchun kompaniya qatori 60 soniya
keshlanadi — to'lov holati ikki bosish orasida o'zgarmaydi. Ikki muhim nuqta:

- SUPERADMIN kompaniyani o'zgartirsa kesh **darhol** tozalanadi, ya'ni
  o'chirish bir daqiqa kutmaydi;
- `expired` keshdan **qayta hisoblanadi**, ya'ni obuna o'z sanasidan bir
  daqiqa ortiq yashay olmaydi.

Mavjud bo'lmagan kompaniya `isActive: false` deb hisoblanadi — bu yerda
«ochiq» yiqilish o'chirilgan tenantni eng imtiyozli qilib qo'yardi.

## 10. Bir vaqtda bitta reys, va band resursni o'chirmaslik (TASK-3.10)

### Ikki marta band qilish

Allaqachon Buxoroga yarim yo'lda ketayotgan mashinada ikkinchi reysni
boshlashga hech narsa to'sqinlik qilmasdi. Keyin **ikkala reys ham** bir xil
GPS trekni, bir xil yoqilg'ini va bir xil kilometrni yig'ardi — ikkalasining
foydasi ham hech bir hisobot ko'rsata olmaydigan tarzda noto'g'ri chiqardi.

**Chegara `IN_PROGRESS`da, ataylab:**

| Holat                                                 | Ruxsat                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------- |
| bir necha reysga **biriktirilgan** (`ASSIGNED`)       | ✅ oddiy rejalashtirish — bugun ketayotgan mashinaga ertangi reys yoziladi |
| bir vaqtda ikki reysda **ketayotgan** (`IN_PROGRESS`) | ❌ jismonan mumkin emas                                                    |

Bu haydovchi, mashina **va tirkama** uchun amal qiladi — tirkama ham bir vaqtda
ikki joyda bo'lolmaydi.

Kafolatni **qisman unique indekslar** beradi:

```sql
CREATE UNIQUE INDEX trips_one_active_per_driver_key ON trips (company_id, driver_id)
  WHERE status = 'IN_PROGRESS' AND driver_id IS NOT NULL;
```

Kodda yozilgan tekshiruvdan ikki parallel `start` **ikkalasi ham** o'tadi;
indeks esa o'tkazmaydi. Koddagi tekshiruv shunchaki **to'sqinlik qilayotgan
reysni nomlaydi** — «TR-2026-0041 reysida» foydali, «unique constraint
violated» esa yo'q. Poygada yutqazgan so'rov `DRIVER_BUSY` / `VEHICLE_BUSY`
(409) oladi, 500 emas.

Prisma bu indekslarni **bilmaydi** (qisman indeks sxemada ifodalanmaydi),
shuning uchun `P2002` xatosida indeks nomi emas, **ustun nomlari** keladi:
`["company_id","driver_id"]`. Moslashtirish aynan shu to'plam bo'yicha —
kelajakda o'sha jadvalga qo'shiladigan boshqa unique indeks «band» deb
o'qilmasligi uchun.

### Band resursni o'chirib bo'lmaydi

Haydovchini yo'l o'rtasida `isActive = false` qilish mumkin edi. `listMine` va
`requireDriverProfile` ikkalasi ham `isActive` bo'yicha filtrlaydi, ya'ni:

- telefonda reys **yo'qoladi**;
- har bir hodisa **rad etiladi**.

Ya'ni o'sha reysning qolgan qismidagi cheklar va yetkazish isboti umuman
yozilmaydi. Endi `ASSIGNED` yoki `IN_PROGRESS` reysi bor haydovchi/texnikani
o'chirishga urinish `RESOURCE_IN_USE` (409) beradi, `details`da to'sqinlik
qilayotgan reys raqami bilan.

Rejalashtirilgan reys ham hisobga olinadi: haydovchisi o'chirilgan `ASSIGNED`
reys — hech qachon boshlanmaydigan reys, va buni hech kim reys kuni ertalabgacha
bilmasdi.

Tugagan reyslar to'sqinlik qilmaydi — yuzta yakunlangan reysi bor haydovchi
aynan nafaqaga chiqariladigan odam. O'chirish avvalgidek **yumshoq**: tarix
joyida qoladi.
