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

| Direction | Ma'nosi                          | Misol                       |
| --------- | -------------------------------- | --------------------------- |
| `DEBIT`   | Mijoz **ko'proq qarzdor** bo'ldi | Reys yakunlandi → invoys     |
| `CREDIT`  | Mijoz **qarzini qopladi**        | To'lov keldi                 |

```
balance = SUM(CREDIT) - SUM(DEBIT)      // manfiy = mijoz qarzdor
debt    = balance < 0 ? -balance : 0    // odam so'raydigan raqam
```

API ikkalasini ham qaytaradi: `balance` — buxgalteriya belgisi bilan, `debt` — «qancha
qarzdor» degan savolga to'g'ridan-to'g'ri javob. Ortiqcha to'lov `debt = 0` va musbat
`balance` bo'ladi (manfiy qarz emas — bu chalkash).

### Qachon yoziladi

| Hodisa                    | Yozuv                                   |
| ------------------------- | --------------------------------------- |
| Reys `COMPLETED` bo'ldi   | `DEBIT` / `TRIP_INVOICED` (`agreedPrice`) |
| Kirim (`Income`) yaratildi | `CREDIT` / `PAYMENT_RECEIVED`           |
| To'lov summasi tuzatildi  | `REVERSAL` + yangi `CREDIT`             |

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
