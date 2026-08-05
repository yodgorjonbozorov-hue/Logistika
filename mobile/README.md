# TruckControl AI — Haydovchi mobil ilovasi (Flutter)

Bu papka pnpm workspace'ga **kirmaydi** — Flutter/Dart alohida boshqariladi.

Ilova skeleti 5-bosqichda yaratiladi (`docs/ROADMAP.md`):

```bash
cd mobile
flutter create truckcontrol_driver --org uz.truckcontrol --platforms android,ios
```

## Rejalashtirilgan tuzilish

```
truckcontrol_driver/lib/
├── core/        # api-klient, offline navbat (drift), gps servisi, i18n
└── features/    # auth, trip, events (8 tugma), fuel_photo, sync
```

## Asosiy talablar (docs/TZ.md 3.4–3.5)

- 8 ta hodisa tugmasi; har bosishda vaqt (UTC), GPS va foto avtomatik.
- **Offline-first:** internet bo'lmasa lokal navbatga yoziladi, aloqa tiklangach
  idempotent batch bilan yuboriladi (`POST /events/batch`, klient UUID).
- Fon rejimida GPS yuborish (30–60 s).
- i18n: uz-latn (asosiy), ru, uz-cyrl — matn kodga yozilmaydi.
- Xarita: flutter_map (OpenStreetMap).
