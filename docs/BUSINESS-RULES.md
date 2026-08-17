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
