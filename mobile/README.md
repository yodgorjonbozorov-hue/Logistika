# TruckControl AI — Haydovchi mobil ilovasi (Flutter)

Bu papka pnpm workspace'ga **kirmaydi** — Flutter/Dart alohida boshqariladi.

## Ishga tushirish

```bash
cd mobile/truckcontrol_driver
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:3000/api/v1   # Android emulator
flutter test && flutter analyze
```

`10.0.2.2` — Android emulatorda host-mashina localhost'i. Haqiqiy qurilmada
kompyuter IP'sini yoki server manzilini bering.

## Tuzilish

```
lib/
├── main.dart            # init: prefs, sqlite, api, queue, gps
├── app_scope.dart       # servis-lokator (InheritedWidget)
├── core/
│   ├── api/             # envelope-unwrap, token refresh
│   ├── db/              # sqflite: pending_events, pending_positions
│   ├── sync/            # offline navbat: idempotent batch (klient UUID)
│   ├── gps/             # geolocator oqimi + 3 daqiqalik flush, foreground service
│   ├── storage/         # token + til (SharedPreferences)
│   └── i18n/            # uz-latn / uz-cyrl / ru (matn kodga yozilmaydi)
└── features/
    ├── auth/            # E-1: telefon + SMS kod
    ├── home/            # E-2: joriy reys + pastki navigatsiya
    ├── events/          # E-3: 10 status tugmasi + forma (foto, spidometr, litr/summa)
    ├── expenses/        # E-5: yozuvlarim (sinxron holati bilan)
    └── profile/         # E-7: profil, til, sinxron hisoblagich, chiqish
```

## Asosiy oqimlar (docs/TZ.md §3)

- **Offline-first:** har hodisa avval SQLite'ga yoziladi (klient UUID bilan),
  so'ng `POST /events/batch`ga idempotent yuboriladi; aloqa qaytganda
  `connectivity_plus` avtomatik sinxronlaydi. Foto avval `/files/upload`ga chiqadi.
- **GPS:** `IN_PROGRESS` reysda geolocator oqimi (50 m filtr) lokal buferga yozadi,
  har 3 daqiqada `POST /tracking/positions` batch; Android'da foreground-notification
  ilova yig'ilganda ham yozishni saqlaydi.
- **i18n:** barcha matn `core/i18n/app_strings.dart`da, test har uch tilda barcha
  kalitlar borligini tekshiradi.
