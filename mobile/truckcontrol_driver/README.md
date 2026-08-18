# TruckControl Driver (Flutter)

Haydovchi ilovasi — offline-first: har bir hodisa avval telefon SQLite'iga yoziladi,
internet paydo bo'lganda idempotent batch bilan serverga yuboriladi (TZ §3.1).

## Ishga tushirish

```bash
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:3000/api/v1   # Android emulator
flutter test
flutter analyze
```

`API_URL` berilmasa Android emulyator manzili (`http://10.0.2.2:3000/api/v1`) ishlatiladi.
Cleartext HTTP faqat **debug** build'da ruxsat etilgan (`android/app/src/debug/res/xml/`),
release build'da `API_URL` `https://` bo'lishi shart — aks holda ilova start'da xato beradi.

## Platforma holati

| Platforma | Holat                                                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android   | Ishlaydi; fon GPS — geolocator foreground-service + bildirishnoma                                                                                                           |
| iOS       | Konfiguratsiya to'liq (`Info.plist` ruxsatlari, `UIBackgroundModes`, `AppleSettings`), lekin **real qurilmada/simulyatorda hali sinalmagan** — 9-bosqich qurilma testlarida |

## Tuzilish

```
lib/core/       api, db (sqflite), sync (offline navbat), gps, storage, i18n
lib/features/   auth, home, events, expenses, profile
test/           offline navbat, i18n qamrovi, GPS platforma sozlamalari
```
