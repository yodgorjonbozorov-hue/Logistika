# Haydovchi ilovasi — ekranlar

Bu rasmlar qo'lda olinmagan: `test/screenshots.dart` haqiqiy `TruckControlApp`
vidjetlarini render qiladi. Ilova kodi o'zgartirilmaydi — faqat tashqi dunyo
soxta: API tayyor javob qaytaradi, baza xotirada, birorta plagin chaqirilmaydi.

```bash
flutter test test/screenshots.dart --update-goldens
```

360 × 780 dp, 3× zichlik (1080 × 2340 px), qorong'i rejim — TZ §3.1 bo'yicha
haydovchi ilovasi doim qorong'i.

| Fayl                     | Ekran                                              |
| ------------------------ | -------------------------------------------------- |
| `01-login-phone.png`     | E-1 kirish — telefon raqami                        |
| `02-login-code.png`      | E-1 kirish — SMS kod                               |
| `03-trip-empty.png`      | E-2 reys yo'q                                      |
| `04-trip-active.png`     | E-2/E-3 faol reys va 10 tugma                      |
| `05-event-start.png`     | «Yo'lga chiqdim» — spidometr + foto                |
| `06-event-refuel.png`    | «Yoqilg'i quydim» — litr + summa + foto            |
| `07-event-expense.png`   | «Yo'l xarajati» — summa + foto                     |
| `08-event-rest.png`      | «Dam / Obed» — faqat izoh                          |
| `09-expenses-empty.png`  | E-5 hali yozuv yo'q                                |
| `10-expenses-list.png`   | E-5 yuborilgan va navbatdagi yozuvlar              |
| `11-documents.png`       | E-6 hujjatlar (keyingi bosqich)                    |
| `12-profile-synced.png`  | E-7 profil — hammasi yuborilgan                    |
| `13-profile-pending.png` | E-7 profil — navbatda yozuv bor                    |
| `14-profile-language.png`| E-7 til tanlash ro'yxati ochiq                     |
| `15-trip-uz-cyrl.png`    | Reys — ўзбекча (кирилл)                            |
| `16-trip-ru.png`         | Reys — русский                                     |
| `17-profile-uz-cyrl.png` | Profil — ўзбекча (кирилл)                          |
| `18-profile-ru.png`      | Profil — русский                                   |
| `19-login-ru.png`        | Kirish — русский                                   |

## Ma'lum farqlar

- Reys kartochkasidagi `→` o'rniga quti ko'rinadi. Bu ilova emas, test muhiti:
  `flutter test` shrift qidiruvini SDK keshi bilan cheklaydi, u yerdagi Roboto
  esa `U+2192` ni o'z ichiga olmaydi. Qurilmada tizim shrifti buni qoplaydi.
- `17-profile-uz-cyrl.png` da pastki menyudagi «Харажатларим» ikki qatorga
  tushib, joyiga sig'may qolgan — bu haqiqiy tor ekran muammosi, tuzatilishi
  kerak.
