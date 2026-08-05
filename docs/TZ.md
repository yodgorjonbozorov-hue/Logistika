# TruckControl AI — Texnik Topshiriq (TZ)

> **Holat:** v0.1 — loyiha egasi tasdig'ini kutmoqda.
> **Manba:** sotuv prezentatsiyasi (`TruckControl AI — sotuv prezentatsiyasi`) asosida tuzilgan.
> Prezentatsiyada bo'lmagan texnik tafsilotlar arxitektor tomonidan taklif sifatida kiritilgan
> va `[TAKLIF]` belgisi bilan ajratilgan. Tasdiqlangach belgi olib tashlanadi.

---

## 1. Umumiy tavsif va maqsad

**TruckControl AI** — O'zbekiston logistika firmalari (5–40 texnika) uchun SaaS tizim.
Maqsad: yuk tashish biznesining barcha operatsiyalarini (reys, yoqilg'i, xarajat, hujjat,
GPS) bitta tizimga yig'ish va har bir mashina/reys bo'yicha **real foydani** ko'rsatish.

Asosiy qiymat takliflari (prezentatsiyadan):

- Yoqilg'i yo'qotishini ~15% dan 3–5% gacha tushirish (nazorat + AI anomaliya).
- Oylik hisobot 2–3 kun o'rniga bir zumda.
- Zararli reyslar darhol ko'rinadi.
- Hujjat muddati o'tishi tufayli shtraflar — 0 (eslatmalar).
- Ma'lumot kiritish qo'lda emas — chek/hujjat fotosidan AI o'qiydi.
- Mijozga yuk kuzatish havolasi.

Biznes-model: oylik obuna, 3 tarif (START 1–5, STANDART 6–15, BIZNES 16–40 texnika).
Har mijoz-firma — alohida **tenant** (kompaniya), ma'lumotlari qat'iy izolyatsiyada.

## 2. Foydalanuvchi rollari

| Rol | Qurilma | Vazifasi |
|---|---|---|
| **Haydovchi (DRIVER)** | Flutter mobil ilova | Reys davomida hodisa tugmalarini bosadi, chek/hujjat fotosini yuboradi. Kompyuter savodxonligi minimal deb hisoblanadi. |
| **Logist (LOGIST)** | Web ilova | Reys ochadi/yopadi, haydovchi va mashina biriktiradi, xaritada kuzatadi, AI o'qigan ma'lumotlarni tasdiqlaydi. |
| **Boshliq (OWNER)** | Web + Telegram | Dashboard, foyda/zarar, ogohlantirishlar, AI-chat, kunlik xulosa. |
| **SUPERADMIN** | Web (ichki) | [TAKLIF] Bizning jamoa: tenant'lar, tariflar, tizim monitoringi. Tenant ichki ma'lumotlariga kirmaydi. |
| **Mijoz (havola)** | Brauzer, autentifikatsiyasiz | Yuk egasiga yuborilgan vaqtincha havola orqali faqat o'z yuki holati/joyini ko'radi. |

## 3. Funksional talablar (modullar bo'yicha)

### 3.1 Kompaniya va foydalanuvchilar
- Kompaniya ro'yxatdan o'tishi, tarif (texnika soni limiti), foydalanuvchilarni boshqarish.
- Rollar: OWNER, LOGIST, DRIVER (bitta kompaniya ichida).
- [TAKLIF] Haydovchi kirishi — telefon raqami + SMS-kod yoki logist bergan PIN; ofis xodimlari — email/parol.

### 3.2 Texnika (mashinalar)
- Fura/tirkama kartochkasi: davlat raqami, marka, yil, yoqilg'i normasi (l/100km), holati.
- Holatlar: 🟢 yo'lda, 🟡 dam/obed, 🔴 nosozlik, ⚪️ bo'sh.
- Mashinaga bog'liq hujjatlar (texpasport, sug'urta, ruxsatnomalar) va muddatlari.

### 3.3 Reyslar
- Logist reys ochadi: marshrut (qayerdan–qayerga), mashina, haydovchi, yuk, kelishilgan narx (kirim).
- Reys bosqichlari haydovchi hodisalari orqali yuriladi; yakunda reys P&L hisoblanadi (6-bo'lim).
- Reysga barcha xarajatlar (yoqilg'i, yo'l, bojxona, ta'mir va h.k.) bog'lanadi.

### 3.4 Haydovchi hodisalari (mobil tugmalar)
Prezentatsiya 5-slayd — 8 ta tugma:
`Yo'lga chiqdim · Yuk ortildi · Obed–dam · Yoqilg'i quydim · Nosozlik · Chegara · Yo'l xarajati · Yuk topshirildi`
- Har bosishda avtomatik: **vaqt (UTC), GPS-joy, ixtiyoriy/majburiy foto**.
- **Offline rejim:** internet bo'lmasa lokal navbatga yoziladi, aloqa tiklangach o'zi yuboradi. Bu MVP talabi, keyinga qoldirilmaydi.
- [TAKLIF] Ovozli izoh qo'shish imkoni (keyin Whisper bilan matnga aylantiriladi).

### 3.5 GPS-kuzatuv va xarita
- Mobil ilova fon rejimida koordinata yuboradi ([TAKLIF] 30–60 soniyada, harakatda; offline'da lokal saqlanadi).
- Web'da jonli xarita: barcha mashinalar, holat ranglari, kartochka (haydovchi, yuk, tezlik).
- Marshrut tarixi (o'tgan davr bo'yicha trek).
- Mijoz havolasi: muddatli, faqat bitta reysga, joy + bosqich ko'rsatadi.

### 3.6 Yoqilg'i nazorati
- Har quyish: chek fotosi → AI o'qiydi (litr, narx, summa, AZS, sana) → logist/boshliq tasdiqlaydi → bazaga.
- Norma bilan taqqoslash (l/100km, reys masofasi bo'yicha).
- Anomaliya AI tomonidan aniqlanadi (4-bo'lim), lekin norma-hisob oddiy kodda.

### 3.7 Hujjatlar
- Turlar: TTN, CMR, bojxona to'lovi, ta'mir cheki, spidometr fotosi, mashina/haydovchi hujjatlari.
- Foto → AI strukturalab o'qiydi → odam tasdiqlaydi → MinIO'da fayl, bazada meta.
- Muddatli hujjatlar bo'yicha eslatmalar (muddati tugashidan oldin ogohlantirish).

### 3.8 Xarajatlar va kirimlar
- Xarajat turlari: yoqilg'i, yo'l haqi, bojxona, ta'mir, oylik/suxarnoy, boshqa.
- Kirim: reys narxi, qo'shimcha to'lovlar. To'lov holati (kutilmoqda/qisman/to'langan), kechikish ogohlantirishi.

### 3.9 Dashboard va hisobotlar
- Boshliq ekrani: yo'ldagi mashina, bugungi reys, kirim, chiqim, **FOYDA**, ogohlantirishlar soni.
- 12 oylik foyda grafigi; har mashina rentabelligi jadvali.
- Davr bo'yicha hisobotlar (kun/oy/yil, mashina/haydovchi/mijoz kesimida), eksport ([TAKLIF] Excel/PDF).
- Har kuni 20:00 (kompaniya mahalliy vaqtida) Telegramga kunlik xulosa.

### 3.10 Bildirishnomalar
- Kanallar: ilova ichida, Telegram bot, [TAKLIF] push.
- Turlari: anomaliya, hujjat muddati, to'lov kechikishi, nosozlik, kunlik xulosa.

## 4. AI funksiyalari va qat'iy chegaralari

| Funksiya | Model | Tavsif |
|---|---|---|
| Chek/hujjat OCR | Claude (vision) — arzon vazifalarga Haiku, murakkabiga Sonnet | Foto → strukturalangan JSON (litr, summa, sana...). Natija **taklif** sifatida saqlanadi, odam tasdiqlaydi. |
| AI-chat («AI-boshliq») | Sonnet | Tabiiy tilda savol («shu oy qaysi mashina zarar keltirdi?») → tizim **oldindan belgilangan hisobot funksiyalari** (tool'lar) orqali javob oladi. Web va Telegram'da. |
| Anomaliya detektsiyasi | Haiku/Sonnet + oddiy kod | Yoqilg'i normadan chetlashishi, takroriy chek, tushunarsiz to'xtash, marshrutdan chetlash, qimmat ta'mir, to'lov kechikishi. Statistik hisob kodda, tushuntirish/tavsiya matni AI'da. |
| Ovoz | Whisper | Haydovchi ovozli xabari → matn. |

**Qat'iy chegaralar (buzib bo'lmaydi):**
1. AI bazaga **hech qachon to'g'ridan-to'g'ri yozmaydi** — faqat «taklif» (draft) yaratadi, odam tasdiqlaydi.
2. AI **SQL yozmaydi** — faqat whitelist qilingan, parametrlangan hisobot funksiyalarini chaqiradi.
3. Moliyaviy hisob-kitoblarni (6-bo'lim) AI emas, deterministik kod bajaradi. AI faqat tayyor raqamlarni izohlaydi.

## 5. Multi-tenant va xavfsizlik

- Har bir yozuv `company_id` ga bog'liq; **har bir so'rov majburiy `company_id` bo'yicha filtrlanadi** — istisno yo'q.
- Bir tenant boshqasining ma'lumotini hech qanday yo'l bilan ko'ra olmaydi (savol-javob slaydidagi va'da: «Har firma alohida, hech kim boshqasini ko'rmaydi»).
- Kunlik zaxira nusxa (backup).
- [TAKLIF] JWT (access + refresh), parollar argon2/bcrypt, fayllar MinIO'da tenant-prefiks bilan, havolalar imzolangan va muddatli.

## 6. Moliyaviy hisob-kitob

> Ushbu bo'limdagi barcha hisoblar **faqat oddiy (deterministik) kodda** bajariladi. AI aralashmaydi.

### 6.1 Pul birligi va saqlash
- Asosiy valyuta: **UZS**. Bazada pul — **BigInt, tiyinda** (1 so'm = 100 tiyin). `float` taqiqlanadi.
- [TAKLIF] Xalqaro reyslar uchun USD/RUB summalar ham tiyin-ekvivalent BigInt + valyuta kodi + kiritilgan kurs bilan saqlanadi; konvertatsiya kursi hujjat kiritilgan paytda qayd etiladi.

### 6.2 Reys foydasi (P&L)
```
reys_foydasi = reys_kirimi − Σ(reysga bog'langan xarajatlar)
xarajatlar   = yoqilg'i + yo'l haqi + bojxona + ta'mir(reysga tegishli)
             + haydovchi_haqi + [TAKLIF] amortizatsiya ulushi (sozlanadigan)
```
- Bo'sh qaytish (yuk-siz qaytish) reys xarajati sifatida hisobga olinadi — prezentatsiya 8-slayd misoli.

### 6.3 Mashina rentabelligi
- Davr bo'yicha: mashinaning barcha reys foydalari − reyssiz xarajatlar (ta'mirda turgan kunlar, sug'urta va h.k.).
- Ta'mirda turgan kunlar zarar sifatida ko'rsatiladi (8-slayd: «12 kun ta'mirda −1.1 mln»).

### 6.4 Yoqilg'i normasi
```
kutilgan_sarf_l = masofa_km × norma_l_100km / 100
chetlashish_%   = (haqiqiy_sarf − kutilgan_sarf) / kutilgan_sarf × 100
```
- Chetlashish chegarasi (default [TAKLIF] 10%) kompaniya sozlamasida; oshsa anomaliya hodisasi yaratiladi.

### 6.5 Yaxlitlash va ko'rsatish
- Barcha arifmetika tiyinda (BigInt), yaxlitlash faqat ko'rsatishda.
- UI'da so'mda, mahalliy formatda (`8 150 000 so'm`).

## 7. Nofunksional talablar

- **Vaqt:** bazada faqat UTC; foydalanuvchiga kompaniya vaqt mintaqasida (default `Asia/Tashkent`) ko'rsatiladi.
- **i18n:** barcha foydalanuvchi matnlari tarjima fayllarida — `uz-latn` (asosiy), `ru`, `uz-cyrl`. Kodga qattiq yozilgan matn taqiqlanadi.
- **API format:** har javob `{ success, data, error, meta }`.
- **Offline:** mobil ilova to'liq offline ishlaydi (hodisalar, foto, GPS lokal navbatda).
- **Hajm:** tenant boshiga 40 tagacha texnika; [TAKLIF] tizim 200 tenant / 2000 texnika'ga mo'ljallab loyihalanadi.
- **Test:** har modul uchun testlar (unit + muhim oqimlarga e2e).
- **Deploy:** Docker Compose, bitta VPS'da boshlanadi.

## 8. Texnik stek (qat'iy)

- Backend: NestJS (TypeScript) + PostgreSQL + Prisma ORM + Redis
- Web: React 18 + TypeScript + Vite + TailwindCSS + TanStack Query
- Mobil: Flutter (Android + iOS)
- Fayl: MinIO (S3-mos)
- AI: Anthropic Claude API (Haiku + Sonnet), nutq — Whisper
- Xarita: OpenStreetMap + Leaflet (web), flutter_map (mobil)
- Deploy: Docker Compose; Monorepo: pnpm workspaces (backend, web), Flutter alohida papka

## 9. MVP chegarasi va keyinga qoldirilganlar

MVP'ga **kirmaydi** (pilotdan keyin): to'lov/billing avtomatikasi, iOS do'kon nashri (avval Android),
marshrut optimizatsiyasi, tashqi GPS-treker integratsiyasi, buxgalteriya (1C) integratsiyasi,
ko'p valyutali murakkab konvertatsiya, mijozlar portali (havoladan tashqari).
