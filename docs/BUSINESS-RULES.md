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

## 11. Katalogni o'chirish — yumshoq, va haqiqatan (TASK-3.11)

### Mijoz endi o'chirilmaydi, nafaqaga chiqariladi

`Driver` va `Vehicle` boshidanoq yumshoq o'chirilardi, `Client` esa **qattiq**
`DELETE` bilan. Tashqi kalitlar reysi yoki kirimi bor mijozni o'chirishga yo'l
qo'ymasdi — va aynan shu haqiqiy muammoni **yashirardi**: hech narsa
biriktirilmagan mijoz uchun o'chirish **muvaffaqiyatli** bo'lardi va qator
butunlay yo'qolardi. Kontragent umuman mavjud bo'lganidan qolgan yagona iz —
audit'dagi `before`.

Endi `Client.isActive`, xuddi boshqalari kabi. `DELETE /clients/:id` marshruti
o'sha-o'sha, lekin u endi nafaqaga chiqaradi.

### Nafaqaga chiqarish qachon rad etiladi

Ikkalasi ham puldan ko'z uzmaslik haqida:

| Sabab                                          | Nega                                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **balans nolga teng emas**                     | Nafaqaga chiqarilgan mijoz ro'yxatdan tushadi, qarz ham u bilan birga — kimdir doimo quvishi kerak bo'lgan yagona raqam |
| **rejalashtirilgan yoki ketayotgan reysi bor** | Uning invoysi hali chiqarilmagan yoki to'lanmagan, ya'ni u ham o'sha qarzga aylanmoqchi                                 |

Bu `Driver`/`Vehicle` uchun TASK-3.10 da qo'yilgan qoidaning bir xil shakli.

### Nafaqaga chiqarilgan yozuv ish ro'yxatidan chiqadi

Avval o'chirilgan yozuv **har bir ro'yxatda va har bir tanlovda** qolardi —
kompaniyani tark etgan haydovchini ertangi reysga bemalol qo'yish mumkin edi.
Hali ham tayinlanishi mumkin bo'lgan yozuv — bu **bayroq, yumshoq o'chirish
emas**, va u TASK-3.10 ning yo'l o'rtasidagi himoyasini eskirgan ro'yxatdan
tanlash orqali bekor qilardi.

- `GET /clients`, `/drivers`, `/vehicles` — default **faqat aktivlar**;
- `?includeInactive=true` — arxiv (tarix o'qilishi shart, yozuv aynan shuning
  uchun saqlangan);
- `count` ham **shu to'plamni** sanaydi, aks holda jadvalning oxirgi sahifasi
  bo'sh chiqadi;
- reysga **yangi** biriktirish (`POST /trips`, `assign`) nafaqaga chiqarilgan
  haydovchi/texnika/mijoz bilan `RESOURCE_IN_USE` (409) beradi.

**Faqat yangi majburiyat** tekshiriladi. Haydovchisi allaqachon ishdan ketgan
**tugagan** reysga chek yozish o'z-o'zidan qabul qilinishi kerak — u chek
tarix, reja emas.

Nafaqaga chiqarilgan mijozning eski reyslari, invoyslari va ledger yozuvlari
joyida qoladi va nomi bilan o'qiladi — yumshoq o'chirishning butun ma'nosi shu.

## 12. Mayda, lekin muhim qoidalar (TASK-3.12)

### Noma'lum maydon jimgina tashlanmaydi (M-22)

`whitelist: true` ortiqcha maydonni **indamay o'chirardi**: `amout` deb yozgan
klient 201 va nol summali xarajat olardi. Endi `forbidNonWhitelisted: true` — 400. Buzuvchi o'zgarish, shuning uchun web va mobil so'rovlari tekshirildi;
bitta joyda haqiqiy muammo topildi: kirim formasi hali ham `status` yuborardi,
holbuki TASK-3.1 dan beri u ledger'dan hisoblanadi. Tanlov formadan olib
tashlandi — server e'tiborsiz qoldiradigan tanlovni ko'rsatish yolg'on.

### Sana ishonarli oyna ichida (M-5, M-6, L-9)

| Maydon                       | Oyna                | Nega                                                                                      |
| ---------------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| `expenseDate`, `paymentDate` | ertaga**gacha**     | ofis va haydovchi yarim tundan ikki tomonda bo'lishi mumkin                               |
| `eventTime` (telefondan)     | +5 daqiqa … −30 kun | 5 daqiqa — oddiy soat farqi; 30 kun — offline navbat ushlab tura oladigan eng uzoq muddat |
| `from`/`to` (ro'yxat filtri) | `@IsDate()`         | avval `?from=kecha` `Invalid Date` bo'lib Prisma'ga borardi va **500** qaytarardi         |

Telefon soati noto'g'ri bo'lishi kamdan-kam emas — bir hafta o'chib turgan
qurilmaning **odatiy holati**. 1970 yoki 2049 sanali hodisa hech qayerda xatoga
o'xshamaydi: u reys tarixini jimgina qayta tartiblaydi va noto'g'ri hisobot
oyiga tushadi.

`TripEvent.receivedAt` (server vaqti) qo'shildi: telefon aytgan vaqt bilan
server qabul qilgan vaqt orasidagi farq — kech sinxronizatsiyani noto'g'ri
soatdan ajratishning yagona yo'li.

### Telefon raqami — bitta shakl (M-3)

`+998901234567`, `998901234567`, `901234567` va `90 123 45 67` — bitta raqam va
**to'rtta akkaunt** edi: kirish qidiruvi unique ustun bo'yicha aniq matn
tengligi. Bir yo'l bilan ro'yxatdan o'tgan haydovchi boshqa yo'l bilan kira
olmasdi, va allaqachon akkaunti bor odamga ikkinchisi ochilishi mumkin edi.

`normalizePhone()` E.164 beradi (`+998...`), DTO transform'ida ishlaydi, bazaga
faqat normallashtirilgan holda yoziladi va `findByIdentifier` ham
normallashtiradi. **Chet el raqami tegilmaydi**: `+` bilan yozilgan raqamning
davlat kodiga ishoniladi — qozog'istonlik haydovchiga `+998` taxmin qilish
ishlaydigan raqamni boshqa birovnikiga aylantirardi. Mavjud qatorlar
migratsiyada tozalandi.

### Token qaror o'zgarganda ishlashdan to'xtaydi (M-2, L-2)

Access token 15 daqiqa yashaydi va **uni o'ldirishi kerak bo'lgan har bir
qarordan omon qolardi**: lavozimi pasaytirilgan foydalanuvchi eski huquqini
saqlardi, o'chirilgani to'liq kirishni, «chiqish» esa umumiy telefonda
oldingi haydovchining tokeni hali ham ishlaydigan chorak soatni qoldirardi.

`User.tokenVersion` — token qaysi avlodda chiqarilgani. Guard uni joriy qiymat
bilan solishtiradi. Oshiriladi: **rol o'zgarishi, deaktivatsiya, parol
o'zgarishi, chiqish**. Deaktivatsiyada refresh tokenlar ham bekor qilinadi —
avval o'chirilgan akkaunt o'ziga yangi access token chiqarib olardi.

Chiqish **barcha** seanslarni tugatadi. Bu ataylab: umumiy telefonda «chiqish»
dan keyin 15 daqiqa ishlaydigan token — aynan chiqish bartaraf qilishi kerak
bo'lgan xavf; boshqa qurilmadan chiqib qolish esa qulaylik masalasi.

Kesh 30 soniya, lekin versiyani oshiradigan har bir yo'l keshni **darhol**
tozalaydi — kechikish faqat ilovadan tashqarida qilingan o'zgarishga tegishli.

### Firma ma'lumoti — faqat ofis uchun (L-1)

`GET /company` INN, manzil, tarif rejasi va obunani qaytaradi. Haydovchiga
bularning hech biri kerak emas va u hammasini ko'ra olardi. Endi
`OWNER`/`LOGIST`/`ACCOUNTANT`.

### Xarajat tuzatish — teskari yozuv, manfiy summa emas (L-8)

`Expense.amount` ataylab ishorasiz, tasdiqlangan xarajat esa o'zgarmas —
ikkalasi birgalikda **tuzatishning umuman iloji yo'q**ligini anglatardi.
Yetkazib beruvchidan qaytgan pul yoki 500 000 o'rniga 5 000 000 deb kiritilgan
chek shunchaki yozib bo'lmasdi.

Yechim — ledger'dagi naqsh: original **qanday yozilgan bo'lsa shunday qoladi**
(moliyaviy yozuvning butun ma'nosi shu), teskari yozuv esa uni bekor qiladi.
Bekor qilingan juftlik nolga yig'iladi, ya'ni xarajat hisoboti ularni hech
qanday ishora konvensiyasisiz o'zaro qisqartiradi. Summani tuzatish = teskari
yozuv + yangi xarajat.

`POST /expenses/:id/reverse` (OWNER/ACCOUNTANT, idempotent), sabab majburiy
(`@MinLength(10)`). `reversal_of_id` unique — bitta xarajat ikki marta bekor
qilinmaydi; teskari yozuvni bekor qilib ham bo'lmaydi.

### Hujjat egasi — polimorf, va shunday qoladi (M-15)

`Document.ownerType` + `ownerId` juftligini hech qanday tashqi kalit ifodalay
olmaydi. Qaror va uning sababi:

`VehicleDocument`/`DriverDocument`/… ga bo'lish haqiqiy FK beradi, lekin to'rtta
deyarli bir xil jadval evaziga, va «muddati tugayotgan barcha hujjatlar»
so'rovi `UNION`ga aylanadi — bu esa aynan eng ko'p kerak bo'ladigan so'rov.

Uning o'rniga orphan **ikki uchidan** oldi olinadi: hujjat yaratadigan modul
egasi shu tenant ichida mavjudligini tekshirishi shart, va TASK-3.10/3.11 dan
keyin egalarning hech biri **umuman o'chirilmaydi** — faqat nafaqaga
chiqariladi. Hozircha `Document` modulining o'zi yozilmagan; qoida shu yerda va
`schema.prisma` izohida uni yozadigan odam uchun qoldirildi.

## 13. Jonli xarita va marshrut tarixi (TASK-4.1)

### O'lchov — BEFORE

Realistik ma'lumot yaratildi: **40 mashina × 90 kun × 30 soniyada bitta nuqta =
10 368 000 qator (3.8 GB)**.

| So'rov             | Reja                                                                         | Natija                   |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------ |
| `live()`           | `Parallel Seq Scan` + butun jadval `Sort`i, **`LIMIT` yo'q**, cost 2 122 483 | **10 daqiqada tugamadi** |
| `history()` 90 kun | `Index Scan`, 258 759 qator, cost 309 133                                    | bitta JSON javobda       |

`live()` ning sababi Prisma'ning `distinct`i: u **klientda** deduplikatsiya
qiladi, ya'ni 40 ta qatorni ko'rsatish uchun 10.4 million qator tarmoqdan
o'tadi. Xarita esa buni **har 30 soniyada** so'raydi.

### Yechim — denormalizatsiya

`Vehicle`ga oxirgi ma'lum joylashuv: `lastLat`, `lastLng`, `lastSpeed`,
`lastSeenAt`, `lastTripId`. Ular har pozitsiya paketi oxirida **har mashina
uchun bitta** `update` bilan yoziladi (500 nuqta, 4 mashina = 4 yozuv).

`live()` endi `gps_tracks`ga **umuman tegmaydi** — O(mashina), O(butun tarix)
emas.

Bitta nozik joy: yozuv `lastSeenAt < yangi vaqt` sharti bilan bajariladi.
Offline turgan telefon navbatini kech bo'shatganda o'sha nuqtalar xaritada
ko'rsatilayotgandan **eskiroq** bo'ladi va ularni yozish markerni orqaga
sudrardi.

### O'lchov — AFTER

| So'rov             | Natija                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| `live()`           | **0.086 ms** (17 buffer) — faqat `vehicles` jadvali                     |
| `history()` 31 kun | **1 080 ms**, 89 280 qator o'qiladi va 2 000 nuqtaga siyraklashtiriladi |

`live()`: **10+ daqiqadan 0.086 ms gacha.**

### `history()` chegaralari

- **oyna ≤ 31 kun** (oshsa 400). Bir oyning o'zi ~86 000 nuqta; undan kengi —
  bu xarita emas, hisobot, va u fonda tayyorlanadigan eksportga tegishli;
- **`take` = 100 001 qator** — bitta so'rov qancha turishi mumkinligining shifti;
- javob **2 000 nuqtagacha siyraklashtiriladi** (`downsample`).

Kesib tashlash emas, **siyraklashtirish**: kesilgan marshrut yolg'on — u
mashina chegara tugagan joyda to'xtagandek ko'rsatadi. Teng oraliqda
siyraklashtirilgani esa o'sha safarning past aniqlikdagi tasviri, polyline
baribir shundan ko'proq ko'rsata olmaydi. **Ikkala uchi ham saqlanadi** —
oxirini yo'qotgan marshrut hech qachon yetib bormagan mashinaga o'xshaydi.

Javob shakli endi `{ points, totalPoints, truncated }` — klient marshrut
siyraklashtirilganini biladi.

### Indekslar

`gps_tracks (vehicle_id, recorded_at DESC)` va `gps_tracks (trip_id)` —
ikkinchisi arxivlash job'i va ochiq kuzatuv havolasi uchun (L-5).

---

## 14. Ro'yxatlar: sahifalash, `count()` va N+1 (TASK-4.2)

### Sahifalash haqiqatan sahifalar edi deb o'ylangan (yangi topilgan: N-10)

`PaginationDto` da `skip` **getter** edi:

```ts
get skip(): number {
  return (this.page - 1) * this.limit;
}
```

`IntersectionType(PaginationDto, DateRangeDto)` esa sinfni uning **o'z**
xossalaridan qayta quradi, prototip getter'i esa o'z xossasi emas. Shu sababli
shu tarzda yig'ilgan har bir DTO — `ListTripsDto`, `ListEventsDto`,
`ListLedgerDto`, `ListAuditLogsDto` — getter'ni yo'qotgan va Prisma'ga
`skip: undefined` yetib borgan. Prisma `undefined` `skip`ni e'tiborsiz
qoldiradi, ya'ni **`?page=2`, `?page=3`, `?page=7` — barchasi 1-sahifani
qaytargan.** Hech qayerda xato otilmagan, `total` ham to'g'ri ko'ringan; shuning
uchun bu shu paytgacha sezilmay kelgan.

Yechim — getter emas, funksiya:

```ts
export function skipOf(dto: PaginationDto): number {
  return (dto.page - 1) * dto.limit;
}
```

`readPage()` faqat shuni chaqiradi, ya'ni yagona nuqta. Testlarda ham
`skip` endi **qo'lda berilmaydi** — u `page` va `limit`dan chiqariladi, chunki
qo'lda berilgan `skip` aynan shu xatoni yashirgan edi.

### `count()` endi majburiy emas

Har ro'yxat so'rovi ikkita so'rov edi: sahifa va `count()`. Katta jadvalda
`count()` — to'liq skan, va u **har sahifada** to'lanadi. Endi:

| Parametr          | Ma'nosi                                                    |
| ----------------- | ---------------------------------------------------------- |
| `withTotal=true`  | (default) `meta.pagination.total` — «1–20, jami 347» uchun |
| `withTotal=false` | `total: null`, `count()` umuman bajarilmaydi               |

`hasMore` **har doim** to'g'ri, chunki u `count()`dan emas, sahifadan bitta
ortiq qator o'qishdan keladi (`take = limit + 1`, ortiqchasi klientga
bermaydi). «Keyingi sahifa» tugmasiga kerak bo'lgani ham aynan shu.

Frontend'da forma select'lari (`useRefLists()`) `withTotal: false` bilan
so'raydi — picker hech qachon «1–100, jami 137» yozmaydi — va `staleTime`
5 daqiqa. Ilgari har forma ochilishida 3 ta so'rov ketardi: bir daqiqada
to'rt marta ochilgan reys oynasi — 12 ta so'rov, yiliga bir necha marta
o'zgaradigan avtopark ro'yxati uchun.

### N+1 lar

- **`events.service`** — `batch` ichida har hodisa uchun alohida `trip` va
  `file` so'rovi ketardi. Endi reyslar va fayl id'lari **bittadan so'rov**
  bilan oldindan o'qiladi; reys statusi o'zgargan hodisadan keyin xotiradagi
  nusxa yangilanadi, ya'ni ketma-ket hodisalar to'g'ri zanjirda ko'riladi.
- **`files.referencedFileIds`** — `trip_events` ni to'liq o'qib, `photoFileIds`
  ni kodda solishtirardi. Endi jsonb `?|` operatori bilan bazada:
  `WHERE photo_file_ids ?| $1::text[]`.
- **`ledger.overdueFor`** — mijozning butun ledger tarixini (DEBIT ham, CREDIT
  ham) qator-baqator o'qirdi. Endi faqat DEBIT'lar qator sifatida, CREDIT'lar
  esa **bitta yig'indi** bo'lib keladi; natija o'zgarmaydi, chunki to'lovlar
  baribir eng eski hisob-fakturadan boshlab yopiladi.

---

## 15. Fon ishlari: navbat, qayta urinish va o'lik xat (TASK-4.3)

`bullmq` va `ioredis` boshidan beri `dependency`da edi va **hech qanday kod
navbat ochmagan** (L-7). Natijada og'ir ishlarning hammasi so'rov oqimida
bajarilardi: haydovchining fotosi `sharp` tugashini kutardi, kirish esa
SMS-shlyuz javobini.

### Navbatlar

| Navbat        | Nima qiladi                                   |
| ------------- | --------------------------------------------- |
| `sms`         | Bir martalik kodlar va xabarnomalar           |
| `files`       | Rasmni kichraytirish                          |
| `gps-archive` | Kechasi GPS arxivlash va retention (TASK-4.4) |

### Qayta urinish siyosati — hamma navbat uchun bir xil

- **3 urinish**, **eksponensial backoff** (5 s dan). 502 qaytargan shlyuz o'n
  soniyadan keyin odatda ishlaydi; haqiqatan o'lgani esa ikki soniyadan keyingi
  to'rtinchi urinishdan tuzalmaydi;
- muvaffaqiyatlilar **qirqiladi** (`removeOnComplete: 100`) — million yashil
  job faqat sekin Redis demakdir;
- muvaffaqiyatsizlar **saqlanadi** (`removeOnFail: 1000`) — hech kim ko'rmagan
  xato hech kim tuzatmagan xato;
- barcha urinish tugagach job **`<navbat>.dead`** ga ko'chiriladi va u yerda
  `removeOnComplete: false` bilan qoladi. Avtomatik o'chib ketadigan o'lik xat —
  hech kim qayta yubormaydigan o'lik xat.

### Fayl yuklash endi kutmaydi

Tekshiruv, virus skani va kvota **so'rov oqimida qoladi** — ular yuklashga
umuman ruxsat bor-yo'qligini hal qiladi. Siqish esa qolmaydi.

1. Rasm **sarlavhasi** (`sharp().metadata()`) darhol o'qiladi — buzuq foto
   baribir **415** bilan qaytariladi, chunki «muvaffaqiyat, keyin hech kim
   ko'rmaydigan FAILED qatori» — bu yolg'on javob;
2. **asl baytlar** darhol MinIO'ga qo'yiladi va `StoredFile` yaratiladi;
3. rasm bo'lsa status `PROCESSING`, `files` navbatiga job qo'yiladi;
4. worker asl faylni o'qib siqadi, **o'sha kalitga** qayta yozadi, `size` va
   `status: READY` ni yangilaydi.

**`PROCESSING` hech qachon «hali yo'q» degani emas** — asl baytlar allaqachon
joyida, imzolangan havola ham ishlaydi. Siqib bo'lmagan rasm `FAILED` bo'ladi va
**asl nusxa saqlanadi**: haydovchi qayta suratga ololmaydigan chekni o'chirish
undan yomonroq.

### SMS holati ko'rinadi

`sms_messages` jadvali: `phone`, `purpose`, `status` (QUEUED/SENT/FAILED),
`attempts`, `lastError`, `sentAt`. **Xabar matni saqlanmaydi** — kirish uchun
u bir martalik kodni o'z ichiga oladi, tirik kodlar jadvali esa o'g'irlashga
arziydigan jadval. Shuning uchun `purpose` (`DRIVER_LOGIN`, `PASSWORD_RESET`)
yoziladi, matn emas.

Worker xatoda **`throw` qiladi** — BullMQ'ga qayta urinish kerakligini shu
aytadi. Yagona qayta urinilmaydigan holat — shlyuz umuman sozlanmagani.
Hisobot yozuvining o'zi (`settle`) xato bersa, job **muvaffaqiyatli** hisoblanadi:
aks holda allaqachon yuborilgan SMS ikkinchi marta ketardi.

### `JOBS_INLINE`

`JOBS_INLINE=true` bo'lsa handler'lar Redis'siz, chaqiruvchi jarayonning
o'zida bajariladi. Bu qulaylik uchun emas: test «foto siqildimi?» degan savolga
«broker qanchalik bandligiga bog'liq» deb javob bermasligi kerak, va
`docker compose up`siz ishlayotgan dasturchi PROCESSING'da abadiy qotib qolgan
fotolar emas, ishlaydigan ilova olishi kerak. Handler kodi ikkala rejimda ham
bir xil — farq faqat **qachon** ishlashida.

---

## 16. Cron'lar: bitta instansiya, va arxivning oxiri bor (TASK-4.4)

### `@Cron` har jarayonda ishlaydi (A-2, M-8)

`@Cron` ilovani ishlatayotgan **har bir** protsessda otiladi. Bitta serverda bu
ko'rinmaydi — audit ham shuning uchun uni «xavf» deb belgilagan, «xato» deb
emas. API ikkinchi instansiyaga kengaytirilgan zahoti kechasi:

- GPS arxivlash **o'sha qatorlarni ikki marta** ko'chiradi;
- token va idempotency tozalash bir-biri bilan poyga qiladi;
- orphan fayl tozalash — ikkinchi protsess har fayl uchun `NoSuchKey` oladi.

Yechim — Redis'dagi **oddiy `SET key token NX PX ttl`**. To'rtala cron ham shu
orqali o'tadi: `gps-archive`, `refresh-token-purge`, `idempotency-purge`,
`orphan-file-purge`.

**Qulf ish tugagach ataylab bo'shatilmaydi.** Instansiyalarning soati kamdan-kam
soniyagacha mos keladi; to'rt soniyadan keyin qaytarilgan qulf — bu keyingi
instansiyaning cron'i to'rt soniyadan keyin ilib oladigan qulf. TTL bilan o'zi
tugashi shu farqni qoplaydi, kunlik ishlarning esa keyingi safargacha butun kuni
bor.

**Redis'ga ulanib bo'lmasa — ish baribir bajariladi.** Bu qulf ortidagi har bir
job idempotent (muddati o'tgan qatorni ikkinchi marta o'chirish hech narsani
o'chirmaydi), ya'ni ikki marta ishlash bir oz protsessor, bir marta ham
ishlamaslik esa **jimgina bajarilmagan tozalash** demakdir.

### Arxivning oxiri (M-9)

`gps_tracks_archive` kechasi to'ldirilardi va **hech qachon tozalanmasdi** —
jadval faqat o'sardi. Endi o'sha job arxivlashdan keyin retention gorizontidan
o'tgan qatorlarni ham o'chiradi.

`GPS_ARCHIVE_RETENTION_DAYS` — standart **730 kun (~2 yil)**: soliq yoki
sug'urta bahsi taxminan shuncha orqaga cho'ziladi. `0` — tozalash o'chirilgan
(hammasini saqlaydigan deploy uchun; u holda eksport o'z zimmasida).

`gps_tracks` ni oylik partitsiyaga o'tkazish rejasi — `docs/ARCHITECTURE.md`
§6 da yozilgan va **ataylab keyinga qoldirilgan** (sabablari o'sha yerda).

---

## 17. GPS nuqtasi ikki marta tushmaydi (TASK-4.5, M-7)

Telefon paketni **server tasdiqlagandan keyingina** «yuborildi» deb belgilaydi.
Oradagi lahzada o'lgan telefon o'sha paketni **qayta yuboradi** — bu nosozlik
emas, offline-first navbatning oddiy ishlashi. `GpsTrack`da nuqtani noyob
qiladigan hech narsa yo'q edi, natijada o'sha koordinatalar ikki marta tushardi:

- har bir **masofa yig'indisi shishardi** — bu per-km oyligi bor haydovchida
  to'g'ridan-to'g'ri pul;
- chizilgan marshrut takrorlangan nuqtalarda **duduqlanardi**.

### Kalit

```
@@unique([companyId, vehicleId, recordedAt])
```

Bitta mashina bitta lahzada bitta joyda bo'ladi. Kalit `company_id` bilan
boshlanadi, ya'ni bir firmaning soati boshqasiniki bilan **hech qachon
to'qnashmaydi**.

### Nega `skipDuplicates`, «avval tekshir» emas

Yozishdan oldin «bu nuqta bormi?» deb o'qish tekshiruv bilan yozuv orasida
oyna qoldiradi, va **bitta telefonning ikkita flush'i** aynan o'sha oynada
poyga qiladi. Dublikatni bazaning o'zi (`ON CONFLICT DO NOTHING`) tashlab
yuboradi — poyga yo'q.

Paketning **o'z ichida** ham bir lahza takrorlanishi mumkin, shuning uchun
qatorlar bazaga borishdan oldin xotirada ham yig'ishtiriladi.

### Javob

```
{ accepted, duplicates, dropped }
```

To'liq qayta yuborilgan paketga to'g'ri javob — «yangisi yo'q»
(`accepted: 0, duplicates: N`), «yana N ta nuqta» emas. `dropped` esa ilgarigidek
— bu haydovchining reysi bo'lmagani uchun rad etilganlar.

Oxirgi ma'lum pozitsiya (TASK-4.1) baribir yangilanadi: dublikat o'sha
koordinatani olib keladi, `lastSeenAt` qorovuli esa xaritadagidan eskisini
allaqachon rad etadi.

---

## 18. Kim qaysi sahifani ochadi (TASK-5.1, M-13)

`ProtectedRoute` faqat **kimdir kirganmi** deb so'rardi, rolni emas. Natijada
web'ga kirgan HAYDOVCHI menyudagi hamma sahifani ko'rardi va har birida
API'dan 403 olardi: qorovul haqiqiy edi, interfeys esa nima ochiqligi haqida
**yolg'on gapirardi**.

### Bitta jadval

`app/routes.ts` — **yagona manba**: router ham, yon menyu ham o'shani o'qiydi.
Menyu taklif qiladigan, lekin router rad etadigan sahifa — bu o'sha xatoning
chiroyliroq ko'rinishi.

| Sahifa             | Rollar                    | Nimaga tayanadi              |
| ------------------ | ------------------------- | ---------------------------- |
| `/map`             | OWNER, LOGIST, ACCOUNTANT | `GET /tracking/live`         |
| `/trips`           | OWNER, LOGIST, ACCOUNTANT | `GET /trips`                 |
| `/vehicles`        | OWNER, LOGIST, ACCOUNTANT | `GET /vehicles`              |
| `/drivers`         | OWNER, LOGIST, ACCOUNTANT | `GET /drivers`               |
| `/clients`         | OWNER, LOGIST, ACCOUNTANT | `GET /clients`               |
| `/finance`         | OWNER, LOGIST, ACCOUNTANT | `GET /expenses`              |
| `/audit-logs`      | **OWNER, SUPERADMIN**     | `GET /audit-logs`            |
| `/change-password` | **hamma** (haydovchi ham) | `POST /auth/change-password` |

Rollar controller'lardagi `@Roles` bilan **aynan mos** — testlar shu juftlikni
qotirib qo'yadi.

### Uch qaror

- **Rol `/auth/me` dan olinadi**, `localStorage`dan emas. Foydalanuvchi
  o'zgartira oladigan rol — qorovul emas.
- **Ruxsat yo'q bo'lsa 403 sahifasi ko'rsatiladi, boshqa sahifaga
  yo'naltirilmaydi.** Jimgina boshqa ekranga otib yuborish foydalanuvchiga
  «menda nimadir buzuq» degan taassurot beradi; sabab aytilishi kerak.
- **`/` endi qat'iy `/trips` emas.** Haydovchi uchun bu butun ilovaning kirish
  ekranini 403 qilib qo'yardi. Endi `/` — shu rol ocha oladigan **birinchi**
  sahifa; hech qaysisi ochilmasa, parol o'zgartirish sahifasi.

Haydovchi uchun yon menyu **butunlay bo'sh** — bu to'g'ri javob: haydovchi
mobil ilovada ishlaydi.

---

## 19. Pul o'zgarishlarida xavfsiz UX (TASK-5.2, M-14)

### To'lov statusi allaqachon qo'lda o'zgarmaydi

Audit «`<Select>` bilan to'lov statusini darhol o'zgartiradi» deb yozgan edi —
bu **TASK-3.1 da** yopilgan: status ledger'dan hisoblanadi va ekranda faqat
`Badge` sifatida ko'rinadi. Bu yerda qolgan qismi bajarildi.

### Tasdiqlash oynasi — nima va qancha

Xarajatni tasdiqlash bitta bosishda, hech narsa ko'rsatmasdan bajarilardi.
Endi tasdiqlash oynasi chiqadi va u **summa va kategoriyani takrorlaydi**.
Bu bezak emas: faqat «ishonchingiz komilmi?» deb so'raydigan oyna — bu odamlar
o'qimasdan yopishni o'rganadigan oyna.

### Tasdiqlangan xarajatni endi orqaga qaytarish mumkin

`POST /expenses/:id/reverse` TASK-3.12 dan beri bor edi, lekin **interfeysda
uni chaqiradigan hech narsa yo'q edi** — ya'ni tasdiqlangan xarajatni tuzatish
yo'li amalda yo'q edi. Endi OWNER/ACCOUNTANT uchun «Bekor qilish» tugmasi bor
va u **sababni majburiy** so'raydi: hech kim izohlamagan tuzatish — bu sababsiz
o'zgargan raqam.

Bekor qilingan qatorda tugma ko'rinmaydi. Bu shunchaki qulaylik — haqiqiy
kafolat bazadagi unique indeks, u ikkinchi bekor qilishni rad etadi.

### Ikki marta bosish

Tasdiqlash/bekor qilish tugmasi so'rov ketayotganda **o'chiriladi**, va
`onConfirm` ichida ham qorovul bor: ikki marta tez bosish React birinchi
holatni qayta chizishga ulgurmasidan ikkinchi submit'ni yuborishi mumkin.
Barcha pul so'rovlari `Idempotency-Key` bilan ketadi (TASK-3.2), ya'ni
o'tib ketgan takror ham ikkinchi yozuv yaratmaydi.

### Summa kiritish

`MoneyInput` — raqamlar **yozilayotganda guruhlanadi** (`1 000 000`) va
o'ng tomonda **«so'm»** yozuvi turadi. Sabab oddiy: `1000000` va `10000000`
bir belgiga farq qiladi, pulda esa o'n million so'mga, va bu xato ledger'ga
tushmaguncha ko'rinmaydi.

`type="number"` **ataylab ishlatilmaydi**: u `1e9` ni jimgina qabul qiladi va
spinner'i bilan sichqoncha g'ildiragi orqali pulni o'zgartirish yo'lini ochadi.
`type="text"` + `inputMode="numeric"`, va tashqariga har doim **toza raqamlar**
beriladi — `somToTiyin` avvalgidek ishlaydi.

---

## 20. Forma validatsiyasi va xato holatlari (TASK-5.3)

### Xato qaysi maydonda ekani ko'rinadi

`ValidationPipe` javobni tekis `string[]` qilib yuboradi va har bir satr
o'zi tegishli maydon nomi bilan boshlanadi:
`"amount must be a tiyin amount (digits only)"`. Bu ro'yxat bitta abzats bo'lib
chiqardi va foydalanuvchi **qaysi katak noto'g'ri ekanini o'zi qidirardi**.

Endi `fieldErrors()` uni maydonlar bo'yicha ajratadi va xabar **o'sha
maydonning tagida** chiqadi. Ajratish **ataylab ehtiyotkor**: birinchi so'zi
ishonchli maydon nomiga o'xshamagan har qanday xabar forma darajasida qoladi —
**noto'g'ri maydon tagidagi xabar yuqoridagisidan yomonroq**.

### Klient tekshiruvi — qoida emas, xushmuomalalik

`validate.ts` dagi tekshiruvlar backend DTO'larini **takrorlaydi**, almashtirmaydi:
server baribir hal qiladi va uning rad javobi baribir ko'rsatiladi. Ular
shunchaki aniq xatoni foydalanuvchi hali o'sha katakka qarab turganda aytadi.

**Muhim qoida: klient serverdan qattiqroq bo'lmasligi kerak.** API qabul
qiladigan narsani rad etadigan klient — umuman tekshirmaganidan yomonroq.

Shu tekshirilganda **haqiqiy nomuvofiqlik topildi**: `IsTiyin` **`0` ni qabul
qilardi**, ya'ni nol so'mlik xarajat yaroqli so'rov edi — hech narsani
anglatmaydigan, hech narsa turmaydigan, lekin har o'rtachani jimgina
kengaytiradigan qator. Ledger allaqachon nolni rad etadi. Endi `IsPositiveTiyin`
bor va u **xarajat, kirim va reys narxiga** qo'llanadi. Haydovchi avansida esa
`0` — «avans berilmagan» degan haqiqiy javob, shuning uchun u o'zgarmadi.

### Skelet yuklagichlar

Jadval va xarita `Spinner` o'rniga **o'z shaklidagi kulrang blok** ko'rsatadi.
Spinner qatorlar kelganda sahifani sakratadi va qancha narsa kelayotgani haqida
hech narsa aytmaydi; to'g'ri balandlikdagi bloklar esa **maketni joyida
ushlab turadi** — butun maqsad shu.
