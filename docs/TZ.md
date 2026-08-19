# TEXNIK TOPSHIRIQ (TZ)

## TruckControl AI — sun'iy intellektga asoslangan logistika boshqaruv tizimi

**Versiya:** 1.0 (MVP)
**Sana:** 2026-yil
**Mahsulot nomi:** TruckControl AI
**Slogan:** _Furangiz qayerda emas — qancha foyda keltiryapti_
**Mahsulot turi:** SaaS (obuna asosida sotiladigan bulutli tizim)

---

# 1. UMUMIY QISM

## 1.1. Muammo

Bugungi kunda 5–50 ta texnika ega bo'lgan logistika firmalari quyidagi muammolar bilan ishlaydi:

| Muammo                                         | Oqibati                                    |
| ---------------------------------------------- | ------------------------------------------ |
| Hisob-kitob daftar yoki Excelda                | Ma'lumot yo'qoladi, tahlil qilib bo'lmaydi |
| Yoqilg'i nazorati yo'q                         | Oyiga 10–20% yoqilg'i "yo'qoladi"          |
| Mashina qayerdaligi noma'lum                   | Mijozga aniq javob berilmaydi              |
| Har bir reys foydami yoki zararmi — bilinmaydi | Zararli yo'nalishlarda yillab ishlanadi    |
| Hujjat muddatlari qo'lda kuzatiladi            | Shtraflar, yo'lda ushlanib qolish          |
| Haydovchi hisoboti og'zaki                     | Nizolar, ishonchsizlik                     |

## 1.2. Yechim

Bitta tizimda: reys boshqaruvi + haydovchi mobil ilovasi + GPS kuzatuv + moliyaviy hisob-kitob + avtomatik hisobotlar.

## 1.3. Tizim maqsadi

1. Har bir reysning **aniq foydasini** ko'rsatish
2. Har bir mashinaning **1 km tannarxini** hisoblash
3. Yoqilg'i sarfini **norma bilan solishtirib** nazorat qilish
4. Boshliqqa **real vaqtda** to'liq manzara berish
5. Haydovchi bilan **hujjatli** hisob-kitob

---

# 2. FOYDALANUVCHI ROLLARI

| Rol                     | Interfeys   | Asosiy vazifasi                                                  |
| ----------------------- | ----------- | ---------------------------------------------------------------- |
| **Super-admin**         | Web         | Firmalarni ro'yxatga olish, obuna boshqaruvi (bu siz — sotuvchi) |
| **Boshliq / Egasi**     | Web + Mobil | Hisobotlar, moliya, tasdiqlash, umumiy nazorat                   |
| **Logist / Dispetcher** | Web         | Reys ochish, haydovchi biriktirish, kuzatish                     |
| **Buxgalter**           | Web         | Xarajat kiritish, to'lovlar, akt-hisobvaraq                      |
| **Haydovchi**           | Mobil       | Reys statusini yuritish, foto yuklash                            |
| **Mijoz** (ixtiyoriy)   | Web-havola  | O'z yukini kuzatish (login shart emas)                           |

**Muhim:** har bir firma faqat o'z ma'lumotini ko'radi (multi-tenant arxitektura).

---

# 3. HAYDOVCHI MOBIL ILOVASI

## 3.1. Dizayn talablari

- Katta tugmalar (yo'lda, qo'lqopda bosish mumkin bo'lsin)
- Minimal matn, ko'p ikonka
- 3 ta til: o'zbek (lotin), o'zbek (kirill), rus
- Qorong'i rejim (tunda haydash uchun)
- **Offline rejim majburiy** — internet yo'q joyda ma'lumot lokal bazada saqlanib, aloqa tiklanganda serverga yuboriladi

## 3.2. Ekranlar ro'yxati

**E-1. Kirish (Login)**

- Telefon raqami → SMS kod
- Yoki logist bergan login/parol

**E-2. Asosiy ekran (Bosh sahifa)**

- Yuqorida: joriy reys (Toshkent → Almaty, №1247)
- O'rtada: katta status tugmalari
- Pastda: navigatsiya (Reyslar / Xarajatlar / Hujjatlar / Profil)

**E-3. Status tugmalari (asosiy funksiya)**

| Tugma                | Nima yoziladi                                            |
| -------------------- | -------------------------------------------------------- |
| 🚚 Yo'lga chiqdim    | Vaqt, GPS, spidometr ko'rsatkichi (foto)                 |
| 📦 Yuk ortildi       | Vaqt, GPS, yuk fotosi, TTN fotosi                        |
| 🍽 Dam / Obed         | Vaqt, GPS, taymer boshlanadi                             |
| ▶️ Davom ettirdim    | Vaqt, GPS, dam davomiyligi hisoblanadi                   |
| ⛽️ Yoqilg'i quydim   | Litr, narx, chek fotosi, GPS, AZS nomi                   |
| ⚠️ Nosozlik          | Muammo tavsifi, foto, GPS — logistga darhol push         |
| 🛃 Chegara / Bojxona | Kirish–chiqish vaqti, xarajat, hujjat fotosi             |
| 💰 Yo'l xarajati     | Turi (bojxona, yo'l boji, shtraf, stoyanka), summa, chek |
| ✅ Yuk topshirildi   | Vaqt, GPS, qabul qiluvchi imzosi (ekranda), foto         |
| 🏁 Reys tugadi       | Yakuniy spidometr (foto), umumiy hisobot                 |

**E-4. Reys tafsiloti**

- Marshrut, mijoz, yuk turi va vazni
- Berilgan avans summasi
- Kutilayotgan yetkazish vaqti
- Logist bilan chat (matn + foto + ovozli xabar)

**E-5. Xarajatlarim**

- Reys bo'yicha kiritgan barcha xarajatlari ro'yxati
- Avans olingan / sarflangan / qoldiq

**E-6. Hujjatlarim**

- Guvohnoma, texpasport, sug'urta fotolari
- Amal qilish muddati va eslatma

**E-7. Profil / Reyting**

- Bajarilgan reyslar soni
- O'rtacha reyting (kechikish, yoqilg'i, nosozlik bo'yicha)
- Oylik hisob-kitob: ishlagan puli, olgan avansi, qoldiq

## 3.3. Fon rejimida GPS

- Har 2–5 daqiqada koordinata yuboriladi (batareyani tejash uchun sozlanadi)
- Internet yo'q bo'lsa — telefonda saqlanadi, keyin paketda yuboriladi
- Ilova yopilganda ham ishlaydi (background service)

---

# 4. WEB PANEL (Logist / Boshliq / Buxgalter)

## 4.1. Ekranlar ro'yxati

**W-1. Dashboard (bosh sahifa)**

Yuqori qatorda 6 ta karta:

- Yo'ldagi mashinalar: 7/10
- Bugungi reyslar: 12
- Oylik kirim: 340 000 000 so'm
- Oylik chiqim: 210 000 000 so'm
- **Sof foyda: 130 000 000 so'm**
- Ogohlantirishlar: 3 ta (qizil)

Pastida:

- Jonli xarita (barcha mashinalar nuqta bilan)
- Oxirgi 10 ta hodisa lentasi ("Alisher A. — nosozlik, Jizzax, 14:20")
- Foyda grafigi (oxirgi 12 oy)

**W-2. Xarita (Jonli kuzatuv)**

- Har bir mashina rangli belgi bilan:
  - 🟢 Yashil — yurmoqda
  - 🟡 Sariq — dam / obed
  - 🔴 Qizil — nosozlik
  - ⚪️ Kulrang — bo'sh / bazada
- Belgini bosganda: haydovchi, yuk, marshrut, tezlik, oxirgi signal vaqti
- **Marshrut tarixi**: sanani tanlab, mashina qayerdan yurganini chizib ko'rsatish
- Rejalashtirilgan marshrutdan chetga chiqsa — ogohlantirish

**W-3. Reyslar**

Ro'yxat + filtr (status, mashina, haydovchi, mijoz, sana).

Yangi reys ochish formasi:

| Maydon                       | Izoh                                |
| ---------------------------- | ----------------------------------- |
| Mijoz                        | Bazadan tanlash yoki yangi qo'shish |
| Yuk nomi, vazni, hajmi       |                                     |
| Yuklash manzili + sana       |                                     |
| Tushirish manzili + sana     |                                     |
| Marshrut                     | Xaritada avtomatik, km hisoblanadi  |
| Mashina + tirkama            | Bo'shlaridan tanlash                |
| Haydovchi                    |                                     |
| **Kelishilgan narx (kirim)** | Mijoz to'laydigan summa             |
| Rejadagi xarajat             | Tizim avtomatik taxmin qiladi       |
| Haydovchiga avans            |                                     |

**W-4. Reys kartochkasi (eng muhim ekran)**

3 ta tab:

1. **Xronologiya** — haydovchi bosgan barcha tugmalar vaqti, joyi, fotolari bilan
2. **Moliya** — kirim, xarajatlar jadvali, **sof foyda avtomatik**
3. **Hujjatlar** — TTN, CMR, invoys, cheklar

**W-5. Avtopark**

Har bir texnika kartochkasi:

- Davlat raqami, marka, model, yil
- Yoqilg'i normasi (l/100 km)
- Joriy probeg
- Hujjatlar: texko'rik, sug'urta, ruxsatnoma + muddatlari
- **Statistika:** shu mashina oyiga qancha ishlab berdi, qancha yedi, 1 km tannarxi
- TO tarixi va keyingi TO qachonligi

**W-6. Haydovchilar**

- Kartochka: shaxsiy ma'lumot, guvohnoma, tajriba
- Reyslar tarixi
- Moliyaviy hisob: ishlagan puli, avanslar, qoldiq
- **Reyting**: kechikishlar, nosozliklar, yoqilg'i farqi, mijoz shikoyati

**W-7. Moliya**

- Kirim: mijozlardan (to'langan / to'lanmagan / muddati o'tgan)
- Chiqim kategoriyalari: yoqilg'i, ta'mir, ehtiyot qism, ish haqi, bojxona, yo'l boji, shtraf, sug'urta, soliq, ofis
- Kassa va bank qoldig'i
- Qarzdorlar ro'yxati (kim qancha qarz)

**W-8. Yoqilg'i nazorati (KILLER-FUNKSIYA)**

Jadval:

| Mashina     | Probeg   | Norma bo'yicha | Real quyilgan | Farq      | Zarar        |
| ----------- | -------- | -------------- | ------------- | --------- | ------------ |
| 01 A 123 AA | 1 240 km | 397 l          | 452 l         | **+55 l** | 550 000 so'm |

- Farq belgilangan foizdan oshsa — avtomatik qizil signal va boshliqqa push
- Oylik "yo'qotilgan yoqilg'i" hisoboti
- AZS bo'yicha tahlil (qaysi zapravkada ko'p farq chiqadi)

**W-9. Hisobotlar**

- Reys bo'yicha foyda/zarar
- Mashina bo'yicha rentabellik
- Yo'nalish bo'yicha rentabellik (Toshkent–Moskva foydalimi?)
- Haydovchi bo'yicha samaradorlik
- Mijoz bo'yicha aylanma
- Xarajat strukturasi (pirog diagramma)
- **Excel / PDF ga eksport**

**W-10. Ogohlantirishlar markazi**

- Hujjat muddati tugayapti (15/7/1 kun qolganda)
- TO vaqti keldi
- Mashina 2 soatdan ortiq qimirlamadi
- Marshrutdan chetga chiqdi
- Yoqilg'i normadan oshdi
- Mijoz to'lovi kechikdi

**W-11. Sozlamalar**

- Firma ma'lumotlari, foydalanuvchilar va huquqlar
- Xarajat kategoriyalari
- Valyuta kurslari
- Telegram-bot ulash

## 4.2. Mijoz uchun tracking-havola

Logist mijozga havola yuboradi → mijoz login qilmasdan ko'radi:

- Yuk qayerda (xaritada)
- Qaysi bosqichda
- Taxminiy yetib borish vaqti

Bu — sotuvda katta ustunlik, mijoz firmani boshqasidan ustun qo'yadi.

---

# 5. MA'LUMOTLAR BAZASI TUZILISHI

PostgreSQL. Asosiy jadvallar:

### companies (firmalar — multi-tenant)

```
id, name, inn, address, phone, logo,
tariff_plan, subscription_until, is_active, created_at
```

### users

```
id, company_id, full_name, phone, email, password_hash,
role (owner/logist/accountant/driver), is_active, last_login
```

### drivers

```
id, company_id, user_id, full_name, phone, birth_date,
passport, license_number, license_expiry,
hire_date, salary_type (fixed/percent/per_km), salary_value,
rating, is_active
```

### vehicles

```
id, company_id, plate_number, type (truck/trailer/special),
brand, model, year, vin,
fuel_type, fuel_norm_per_100km, tank_capacity,
current_odometer, insurance_expiry, tech_inspection_expiry,
next_service_odometer, is_active
```

### clients

```
id, company_id, name, inn, contact_person, phone, email,
address, payment_terms_days, balance
```

### trips (reyslar)

```
id, company_id, trip_number,
client_id, vehicle_id, trailer_id, driver_id,
cargo_name, cargo_weight, cargo_volume,
loading_address, loading_lat, loading_lng, loading_date,
unloading_address, unloading_lat, unloading_lng, unloading_date,
planned_distance_km, actual_distance_km,
agreed_price, currency,
driver_advance,
status (draft/assigned/in_progress/completed/cancelled),
start_odometer, end_odometer,
started_at, finished_at, created_by, created_at
```

### trip_events (haydovchi bosgan tugmalar)

```
id, trip_id, driver_id,
event_type (start/loaded/rest/resume/refuel/breakdown/
            customs/expense/delivered/finish),
event_time, lat, lng, address,
odometer, comment,
photo_urls (jsonb), is_synced, created_at
```

### expenses (xarajatlar)

```
id, company_id, trip_id, vehicle_id, driver_id,
category (fuel/toll/customs/repair/parts/fine/parking/
          salary/insurance/tax/other),
amount, currency, quantity, unit_price,
description, receipt_photo, payment_method,
expense_date, created_by, is_approved
```

### fuel_logs (yoqilg'i)

```
id, trip_id, vehicle_id, driver_id,
liters, price_per_liter, total_amount,
station_name, odometer, lat, lng,
receipt_photo, refuel_time
```

### incomes (kirimlar)

```
id, company_id, trip_id, client_id,
amount, currency, payment_date, payment_method,
invoice_number, status (pending/partial/paid/overdue)
```

### gps_tracks

```
id, vehicle_id, trip_id, lat, lng, speed, heading,
recorded_at
```

> Bu jadval juda tez o'sadi — 90 kundan keyingi yozuvlarni arxivga ko'chirish yoki TimescaleDB ishlatish tavsiya etiladi.

### maintenance (TO va ta'mir)

```
id, vehicle_id, type (planned_to/repair),
description, odometer, cost, parts_list,
service_name, service_date, next_service_odometer
```

### documents

```
id, company_id, owner_type (vehicle/driver/company/trip),
owner_id, doc_type, doc_number,
issue_date, expiry_date, file_url, reminder_sent
```

### notifications

```
id, company_id, user_id, type, title, message,
related_type, related_id, is_read, created_at
```

---

# 6. ASOSIY HISOB-KITOB FORMULALARI

**Reys sof foydasi:**

```
Foyda = Kelishilgan narx − (yoqilg'i + yo'l boji + bojxona +
        haydovchi ulushi + shtraf + boshqa xarajatlar +
        amortizatsiya)
```

**Amortizatsiya (reysga tegishli ulush):**

```
Amortizatsiya = (Mashina narxi ÷ Rejadagi umumiy probeg) × Reys km
```

**1 km tannarxi:**

```
Tannarx/km = (Oylik barcha xarajat + amortizatsiya) ÷ Oylik probeg
```

**Yoqilg'i farqi:**

```
Norma = (Probeg ÷ 100) × Norma_l_100km
Farq = Real quyilgan − Norma
Zarar = Farq × Yoqilg'i narxi
```

**Mashina rentabelligi (ROI):**

```
ROI = (Mashina kirimi − Mashina xarajati) ÷ Mashina xarajati × 100%
```

---

# 7. TEXNIK STEK

| Komponent        | Texnologiya                            | Sabab                                            |
| ---------------- | -------------------------------------- | ------------------------------------------------ |
| Mobil ilova      | **Flutter**                            | Bitta koddan Android + iOS                       |
| Web panel        | **React** yoki **Vue 3**               | Tez, komponentli                                 |
| Backend          | **Node.js (NestJS)** yoki **Laravel**  | Ishlab chiquvchi topish oson                     |
| Baza             | **PostgreSQL**                         | Ishonchli, geodata (PostGIS) qo'llab-quvvatlaydi |
| Kesh / navbat    | **Redis**                              | GPS oqimi, bildirishnomalar                      |
| Fayl saqlash     | **S3 / MinIO**                         | Fotolar, cheklar                                 |
| Xarita           | **Yandex Maps** yoki **OpenStreetMap** | MDH hududida aniq                                |
| Push             | **Firebase Cloud Messaging**           | Bepul                                            |
| Bildirishnoma    | **Telegram Bot API**                   | Boshliqlar Telegramni doim ochadi                |
| Hosting          | **VPS (Ubuntu) + Docker**              | Arzon, boshqarish oson                           |
| AI (matn + rasm) | **Claude API** (Haiku + Sonnet)        | Vision, o'zbek tili, function calling            |
| Nutqni matnga    | **Whisper API**                        | O'zbek va rus tilini yaxshi tushunadi            |
| AI navbat        | **Redis + worker**                     | Foto/ovoz fonda qayta ishlanadi                  |

---

# 8. AI MODULI (tizimning yadrosi)

## 8.0. Asosiy tamoyil

AI tizimda **hamma joyda emas**, aniq belgilangan 8 ta nuqtada ishlaydi. Har birida qat'iy qoida:

> **AI faqat o'qiydi va taklif qiladi. Bazaga yozishni har doim odam tasdiqlaydi.**

Bu ikki narsani kafolatlaydi: xarajat nazorat ostida bo'ladi va AI xatosi moliyaviy zararga aylanmaydi.

## 8.1. AI funksiyalari xaritasi

| №    | Funksiya                            | Kim ishlatadi        | Nima beradi                         |
| ---- | ----------------------------------- | -------------------- | ----------------------------------- |
| AI-1 | Ovozli kiritish                     | Haydovchi            | Rulda qo'l bilan yozmaydi           |
| AI-2 | Chek/hujjatni fotodan o'qish        | Haydovchi, buxgalter | Qo'lda kiritish yo'qoladi           |
| AI-3 | AI-boshliq (savol–javob)            | Boshliq              | Hisobot izlamaydi, so'raydi         |
| AI-4 | Anomaliya detektori                 | Tizim avtomatik      | O'g'irlik va nosozlikni o'zi topadi |
| AI-5 | Narx maslahatchisi                  | Logist               | Zararli reysga rozi bo'lmaydi       |
| AI-6 | ETA bashorati                       | Logist, mijoz        | Aniq yetkazish vaqti                |
| AI-7 | Nosozlik bo'yicha dastlabki tashxis | Haydovchi, logist    | Tez qaror, kam turib qolish         |
| AI-8 | Kunlik AI-xulosa                    | Boshliq              | Har kuni 1 xabar — hammasi ma'lum   |

---

## 8.2. AI-1 — Ovozli kiritish

**Ssenariy:** haydovchi mikrofon tugmasini bosib gapiradi:

> _"Jizzaxda uch yuz litr quydim, to'rt million ikki yuz ming, chek bor"_

**Ish jarayoni:**

1. Ovoz yoziladi → matnga o'giriladi (Whisper API, o'zbek/rus tilini tushunadi)
2. Matn AI ga struktura qilish uchun yuboriladi
3. AI JSON qaytaradi
4. Haydovchiga ekranda **tasdiqlash oynasi** chiqadi → "To'g'rimi? ✅ / ✏️ Tuzatish"
5. Tasdiqlangandan keyingina bazaga yoziladi

**System prompt mantiqi:**

```
Sen logistika tizimining ma'lumot ajratuvchisisan.
Haydovchi nutqidan quyidagi JSON ni chiqar. Hech qanday
izoh yozma, faqat JSON qaytar. Aniq bo'lmagan maydonni
null qoldir — hech qachon o'ylab topma.

{
  "event_type": "refuel|expense|breakdown|rest|delivered|other",
  "liters": number|null,
  "amount": number|null,
  "currency": "UZS|USD|RUB|KZT",
  "location": string|null,
  "category": "fuel|toll|customs|repair|fine|parking|other",
  "comment": string,
  "confidence": 0.0-1.0
}
```

**Muhim qoidalar:**

- `confidence < 0.7` bo'lsa — avtomatik saqlanmaydi, haydovchidan qayta so'raladi
- Ovoz fayli 30 kun saqlanadi (nizo chiqsa dalil bo'ladi)
- Internet yo'q bo'lsa — ovoz navbatga qo'yiladi, aloqa kelganda qayta ishlanadi

---

## 8.3. AI-2 — Chek va hujjatni fotodan o'qish (OCR + Vision)

Bu **eng ko'p vaqt tejaydigan** funksiya.

**Qo'llab-quvvatlanadigan hujjatlar:**

| Hujjat           | AI nimani chiqaradi                                 |
| ---------------- | --------------------------------------------------- |
| AZS cheki        | Litr, 1 l narxi, umumiy summa, sana, vaqt, AZS nomi |
| TTN / yuk xati   | Yuk nomi, vazni, jo'natuvchi, qabul qiluvchi, raqam |
| CMR              | Xalqaro yuk ma'lumotlari, marshrut                  |
| Bojxona to'lovi  | Summa, valyuta, post nomi                           |
| Ta'mir cheki     | Ehtiyot qism ro'yxati, ish haqi, umumiy summa       |
| Shtraf qarori    | Summa, sabab, sana, mashina raqami                  |
| Spidometr fotosi | Probeg raqami                                       |

**Ish jarayoni:**

```
Foto → siqiladi (max 1500px) → base64 → AI Vision
     → JSON → tekshiruv → tasdiqlash oynasi → baza
```

**Avtomatik tekshiruvlar (AI dan keyin):**

- Summa = litr × 1 litr narxi (±1% farq bo'lsa ogohlantirish)
- Chek sanasi reys sanasi ichidami?
- Chekdagi joy GPS ga mos keladimi? (mos kelmasa qizil bayroq)
- Bu chek ilgari yuklanganmi? (takroriy chek — firibgarlik belgisi)

**Takroriy chek tekshiruvi:** har chekdan hash olinadi. Bir xil chek 2 marta yuklansa — boshliqqa darhol signal. Amalda bu tez-tez uchraydigan holat.

---

## 8.4. AI-3 — AI-boshliq (tabiiy tilda savol–javob)

Boshliq Telegramda yoki panelda oddiy gap bilan so'raydi:

> _"Shu oy qaysi mashina zarar keltirdi?"_
> _"Alisher aka nechta reys qildi, qancha yoqilg'i farqi bor?"_
> _"O'tgan oyga nisbatan foyda o'sdimi?"_
> _"Toshkent–Moskva yo'nalishi foydalimi?"_
> _"Kim menga qarzdor?"_

**Texnik yechim — 2 bosqichli, xavfsiz:**

**1-bosqich.** AI savolni **oldindan tayyorlangan so'rovlar to'plamiga** moslashtiradi (function calling). Masalan:

```
get_vehicle_profit(period, vehicle_id)
get_driver_stats(period, driver_id)
get_fuel_anomalies(period)
get_route_profitability(period, route)
get_receivables(status)
compare_periods(metric, period1, period2)
```

**2-bosqich.** Tizim SQL ni **o'zi** bajaradi (AI SQL yozmaydi!), natijani AI ga beradi, AI odam tilida javob yozadi + grafik turini tanlaydi.

**Nima uchun aynan shunday:**

- AI to'g'ridan-to'g'ri SQL yozsa — xato so'rov yoki ma'lumot sizib chiqishi xavfi bor
- Function calling da AI faqat "qaysi funksiya, qanday parametr" ni tanlaydi — bu 100% xavfsiz

**Javob namunasi:**

> 📉 **Iyul oyida 2 ta mashina zarar keltirdi:**
> • 01 A 456 BB — **−4.2 mln so'm** (3 ta reysdan 2 tasi zarar, sabab: bo'sh qaytish)
> • 01 B 789 CC — **−1.1 mln so'm** (12 kun ta'mirda turdi)
>
> Eng foydalisi: 01 A 123 AA — **+18.6 mln so'm**
> [Grafikni ko'rish] [Batafsil hisobot]

---

## 8.5. AI-4 — Anomaliya detektori (avtomatik nazorat)

Har kuni tunda (yoki hodisa yuz berganda) tizim ma'lumotni AI ga tahlilga beradi.

**Nimani topadi:**

| Anomaliya              | Qanday aniqlanadi                                              |
| ---------------------- | -------------------------------------------------------------- |
| Yoqilg'i o'g'irligi    | Real sarf > norma + belgilangan foiz, bir necha reys ketma-ket |
| Tushunarsiz to'xtash   | GPS bir joyda 2+ soat, "dam" tugmasi bosilmagan                |
| Marshrutdan chetlash   | Rejadagi yo'ldan X km uzoqlashish                              |
| Qimmat ta'mir          | Xuddi shu ish o'rtacha narxdan 40%+ qimmat                     |
| Chek nomuvofiqligi     | AZS joyi GPS bilan mos emas                                    |
| Tez-tez "nosozlik"     | Bir haydovchida boshqalarga nisbatan ko'p                      |
| Reys vaqti cho'zilishi | Odatdagi shu marshrutdan sezilarli uzoq                        |

**Muhim nuqta:** AI faqat "raqam oshdi" demaydi, **sababini taxmin qiladi va nima qilishni aytadi**:

> ⚠️ **01 A 456 BB — yoqilg'i anomaliyasi**
> Oxirgi 4 reysda norma o'rtacha 12% oshgan (jami ~180 l, ≈2.1 mln so'm).
> Barcha ortiqcha quyish bir xil AZS da (Sirdaryo, "Neft-Servis").
> Boshqa haydovchilar shu AZS da normal ko'rsatkich beryapti.
>
> **Tavsiya:** shu haydovchining oxirgi 4 chekini qayta tekshiring; forsunka diagnostikasini ham istisno qilmang.

## 8.6. AI-5 — Narx maslahatchisi

Yangi buyurtma kelganda logist marshrutni kiritadi → AI 3 soniyada javob beradi.

**AI nimaga tayanadi:**

- Shu yo'nalishdagi oldingi reyslar tarixi
- Mashinaning real l/100 km ko'rsatkichi
- Joriy yoqilg'i narxi
- Yo'l boji, bojxona xarajatlari tarixi
- Bo'sh qaytish ehtimoli
- Mavsumiylik (qish — sarf ko'proq)

**Javob namunasi:**

> **Toshkent → Moskva, 20 t, tent**
> Taxminiy tannarx: **9.2 mln so'm** (±8%)
> • Yoqilg'i: 5.4 mln • Yo'l/bojxona: 1.8 mln • Haydovchi: 1.5 mln • Amortizatsiya: 0.5 mln
>
> ✅ Tavsiya etilgan minimal narx: **12.5 mln so'm** (foyda ~26%)
> ⚠️ 10.5 mln dan past narx — zarar zonasi
> 📊 Oxirgi 6 oyda shu yo'nalishda o'rtacha 13.1 mln olingan

Bu funksiya bitta reysning o'zida dastur yillik narxini qoplaydi.

## 8.7. AI-6 — ETA bashorati

Klassik navigator "sof haydash vaqti" ni beradi. AI esa **real tarixga** tayanadi: shu haydovchi, shu marshrut, shu mavsum, chegaradagi o'rtacha navbat, dam olish rejimi.

Natija: _"Yetib borish: 14-avgust, 09:00–13:00 oralig'i (ishonch 82%)"_ — mijozga aynan shu yuboriladi.

Kechikish xavfi paydo bo'lsa (chegarada uzoq turib qoldi) — logistga oldindan ogohlantirish.

## 8.8. AI-7 — Nosozlik bo'yicha dastlabki tashxis

Haydovchi "⚠️ Nosozlik" bosadi → foto + ovozli izoh yuboradi.

AI qaytaradi:

- Ehtimoliy sabab (2–3 variant)
- Yurish mumkinmi yoki evakuator kerakmi
- Taxminiy ehtiyot qism va narx oralig'i
- Shu mashinaning oldingi shunga o'xshash nosozliklari

> ⚠️ **Muhim ogohlantirish:** AI tashxisi faqat **dastlabki yo'naltirish**. Yakuniy qaror — usta va logistda. Bu ekranda alohida yozib qo'yiladi.

## 8.9. AI-8 — Kunlik xulosa

Har kuni soat 20:00 da boshliqning Telegramiga bitta xabar:

> 📊 **6-avgust yakuni**
> Yo'lda: 7 mashina • Tugagan reys: 3 • Yangi: 2
> Bugungi kirim: 42 mln • Chiqim: 26 mln • **Foyda: 16 mln**
>
> ⚠️ **E'tibor talab qiladi (2):**
> • 01 A 456 BB — yoqilg'i normadan 12% oshdi
> • "Alfa Trans" — to'lov 8 kun kechikdi (34 mln)
>
> 📅 **Ertaga:** 2 ta yuklash, 1 ta sug'urta muddati tugaydi

## 8.10. AI uchun qo'shimcha baza jadvallari

### ai_requests (barcha AI murojaatlari logi)

```
id, company_id, user_id, feature (voice/ocr/chat/anomaly/pricing/eta/diagnosis/digest),
input_type, input_ref, model_used,
prompt_tokens, completion_tokens, cost_usd,
response_json, confidence,
is_confirmed, confirmed_by, corrected_data,
latency_ms, created_at
```

> `corrected_data` maydoni juda muhim: foydalanuvchi AI xatosini tuzatsa, shu yozib boriladi. Keyinchalik promptni yaxshilash va sifatni o'lchash uchun asos bo'ladi.

### ai_insights (AI topgan anomaliyalar)

```
id, company_id, type, severity (low/medium/high/critical),
title, description, recommendation,
related_type, related_id, estimated_loss,
status (new/reviewed/confirmed/false_positive/resolved),
reviewed_by, created_at
```

> `false_positive` statusi — AI noto'g'ri signal berganini belgilash uchun. Bu ko'rsatkich orqali tizim sifati o'lchanadi.

### ai_settings (har bir firma uchun sozlama)

```
id, company_id,
voice_enabled, ocr_enabled, chat_enabled, anomaly_enabled,
fuel_deviation_threshold (default 7%),
idle_alert_hours (default 2),
route_deviation_km (default 20),
digest_time, digest_channels (jsonb),
monthly_ai_limit_usd, current_month_usage
```

## 8.11. AI xarajati (real hisob)

10 ta mashinali firma uchun oyiga:

| Funksiya               | Hajm/oy        | Model          | Taxminiy narx |
| ---------------------- | -------------- | -------------- | ------------- |
| Ovozli kiritish        | ~600 ta        | Whisper        | $3            |
| Chek/hujjat OCR        | ~500 ta foto   | Vision (Haiku) | $8            |
| AI-boshliq savollari   | ~200 ta        | Sonnet         | $6            |
| Anomaliya tahlili      | 30 ta (kunlik) | Sonnet         | $9            |
| Narx maslahatchisi     | ~100 ta        | Haiku          | $2            |
| ETA + tashxis + xulosa | —              | Haiku/Sonnet   | $4            |
| **JAMI**               |                |                | **≈ $32/oy**  |

Tarif narxi 1.8 mln so'm (~$140) bo'lganda AI xarajati **~23%**. Bu qabul qilinadigan ko'rsatkich.

**Xarajatni kamaytirish usullari:**

- Oddiy vazifalarga arzon model (Haiku), murakkabga kuchli model (Sonnet)
- Fotoni yuborishdan oldin siqish (1500px yetarli)
- Takroriy savollarni keshlash (24 soat)
- Har firmaga oylik limit — oshsa sekin rejimga o'tadi va boshliqqa xabar beriladi
- Statistik hisob-kitoblarni AI emas, **oddiy kod** bajaradi. AI faqat izohlaydi.

## 8.12. AI xavfsizligi va cheklovlari

**Qat'iy qoidalar:**

1. **AI hech qachon bazaga to'g'ridan-to'g'ri yozmaydi.** Faqat taklif → odam tasdiqlaydi → tizim yozadi.
2. **AI SQL yozmaydi.** Faqat oldindan tayyorlangan funksiyalarni chaqiradi (function calling).
3. **Har so'rov `company_id` bilan chegaralanadi.** Bir firma ma'lumoti boshqasiga hech qachon ko'rinmaydi.
4. **Shaxsiy ma'lumot maskalanadi.** Pasport, telefon, hisob raqamlar AI ga yuborilmaydi — faqat ID.
5. **Fallback majburiy.** AI servisi ishlamay qolsa, tizim to'liq qo'lda rejimda ishlashda davom etadi. AI — qulaylik, majburiyat emas.
6. **Har javobda manba ko'rsatiladi.** "Bu xulosa 47 ta reys ma'lumotiga asoslangan" — boshliq ishonch darajasini biladi.
7. **Moliyaviy raqamni AI hisoblamaydi.** Foyda, tannarx, yoqilg'i farqi — bularni **kod hisoblaydi** (6-bo'limdagi formulalar bo'yicha). AI faqat tayyor raqamni izohlaydi. Bu — printsipial talab.

**Xatoga munosabat:** har AI javobida "✏️ Tuzatish" tugmasi. Tuzatish `ai_requests.corrected_data` ga yoziladi va oylik aniqlik hisoboti chiqariladi (maqsad: OCR ≥95%, ovoz ≥90%).

## 8.13. AI ni bosqichma-bosqich joriy qilish

| Bosqich   | Nima qo'shiladi                         | Sabab                                     |
| --------- | --------------------------------------- | ----------------------------------------- |
| MVP       | AI-2 (chek OCR)                         | Eng aniq foyda, sotishda darhol ko'rinadi |
| 2-bosqich | AI-1 (ovoz), AI-4 (anomaliya)           | Haydovchi va nazorat                      |
| 3-bosqich | AI-3 (AI-boshliq), AI-8 (kunlik xulosa) | Boshliqni ushlab qoladi                   |
| 4-bosqich | AI-5 (narx), AI-6 (ETA), AI-7 (tashxis) | Yetarli tarixiy ma'lumot to'plangach      |

> AI-5 va AI-6 uchun kamida **3–6 oylik real ma'lumot** kerak. Ma'lumotsiz bashorat ishonchsiz bo'ladi — shuning uchun ular oxirgi bosqichda.

---

# 9. TIZIM XAVFSIZLIGI

- JWT autentifikatsiya + refresh token
- Rollarga asoslangan huquqlar (RBAC)
- Har bir so'rov `company_id` bo'yicha filtrlanadi (firmalar bir-birini ko'rmaydi)
- Barcha o'zgarishlar audit-log ga yoziladi (kim, qachon, nimani o'zgartirdi)
- Kunlik avtomatik backup
- Fotolar va hujjatlar shifrlangan saqlash
- HTTPS majburiy

---

# 10. ISHLAB CHIQISH BOSQICHLARI

## Bosqich 1 — MVP (8–10 hafta)

- [ ] Autentifikatsiya, rollar, multi-tenant
- [ ] Avtopark, haydovchilar, mijozlar bazasi
- [ ] Reys ochish va boshqarish
- [ ] Haydovchi ilovasi: 10 ta status tugmasi + GPS + foto
- [ ] Xarita: jonli kuzatuv
- [ ] Xarajat kiritish
- [ ] Reys foydasi hisobi
- [ ] **AI-2: chek/hujjatni fotodan o'qish**
- [ ] Dashboard + 3 ta asosiy hisobot

**MVP bilan sotuvni boshlash mumkin.**

## Bosqich 2 (4–6 hafta)

- [ ] Yoqilg'i nazorati moduli
- [ ] Hujjat muddati eslatmalari
- [ ] TO rejalashtirish
- [ ] Telegram-bot
- [ ] Excel / PDF eksport
- [ ] Haydovchi reytingi
- [ ] **AI-1: ovozli kiritish**
- [ ] **AI-4: anomaliya detektori**

## Bosqich 3 (4–6 hafta)

- [ ] Mijoz uchun tracking-havola
- [ ] Chat (logist ↔ haydovchi)
- [ ] Offline rejim to'liq
- [ ] Marshrutdan chetga chiqish nazorati
- [ ] Kengaytirilgan analitika
- [ ] **AI-3: AI-boshliq (savol-javob)**
- [ ] **AI-8: kunlik AI-xulosa**

## Bosqich 4 (kelajak)

- [ ] GPS-treker / OBD-II integratsiya (telefonsiz)
- [ ] Yoqilg'i datchigi integratsiyasi
- [ ] 1C / buxgalteriya integratsiyasi
- [ ] Yuk birjasi (mijoz ↔ tashuvchi)
- [ ] **AI-5: narx maslahatchisi**
- [ ] **AI-6: ETA bashorati**
- [ ] **AI-7: nosozlik tashxisi**

---

# 11. BREND

> **Yangilanish (2026, brand board V1.0):** brend **Logixa AI** ga o'zgardi —
> Deep Navy `#0D1220` + Electric Blue `#0A84FF`. Quyidagi 11.0 bo'limi tarixiy
> holat sifatida qoladi; amaldagi palitra, tipografika va komponentlar —
> [`docs/DESIGN.md`](DESIGN.md).

## 11.0. Nom va identifikatsiya

**Nom:** TruckControl AI
**Qisqa yozuv:** TC AI
**Domen:** truckcontrol.ai / truckcontrol.uz (band bo'lsa — gettruckcontrol.com)

**Slogan variantlari:**

- Asosiy: _Furangiz qayerda emas — qancha foyda keltiryapti_
- Qisqa: _Aqlli logistika nazorati_
- Rus tilida: _Не где фура — а сколько она приносит_
- Ingliz tilida: _Know where. Know how much._

**Logotip konsepsiyasi:**
Fura silueti, ichida yoki ostida yuqoriga qarab ketayotgan grafik chizig'i. Ikkinchi variant — "TC" monogrammasi yo'l chizig'i shaklida. Ikonka kvadrat ichida ham o'qiladigan bo'lishi shart (mobil ilova uchun).

**Rang palitrasi:**

| Rang                  | Kod       | Qayerda                 |
| --------------------- | --------- | ----------------------- |
| To'q ko'k (ishonch)   | `#1B2A4A` | Asosiy fon, sarlavhalar |
| To'q sariq (harakat)  | `#F5A623` | Tugmalar, urg'u         |
| Yashil (foyda)        | `#2FAE6A` | Ijobiy raqamlar         |
| Qizil (ogohlantirish) | `#E14B4B` | Anomaliya, zarar        |
| Kulrang               | `#8A94A6` | Ikkinchi darajali matn  |

Qorong'i rejim majburiy — haydovchilar tunda ishlaydi.

**Nom haqida ogohlantirish:** "Truck Control" — umumiy ibora, yolg'iz o'zi tovar belgisi sifatida himoyalanishi qiyin. Ro'yxatdan o'tkazishda **"TruckControl AI"** ni logotip bilan birga (kombinatsiyalangan belgi) topshirish tavsiya etiladi — himoya ehtimoli sezilarli yuqori. Domen, Telegram username va Intellektual mulk agentligi bazasi loyihani boshlashdan **oldin** tekshirilsin.

---

# 12. BIZNES MODELI (sotish rejasi)

## 12.1. Tariflar

| Tarif          | Texnika soni | Narx (oyiga)     |
| -------------- | ------------ | ---------------- |
| **Start**      | 1–5          | 800 000 so'm     |
| **Standart**   | 6–15         | 1 800 000 so'm   |
| **Biznes**     | 16–40        | 3 500 000 so'm   |
| **Korporativ** | 40+          | Kelishuv asosida |

Qo'shimcha daromad:

- O'rnatish va sozlash: 3–5 mln so'm (bir martalik)
- Xodimlarni o'qitish: 1–2 mln so'm
- Individual funksiya buyurtmasi: soatbay
- Serverda saqlash (yillik arxiv)

## 12.2. Sotuv strategiyasi

**1-qadam.** 2 ta tanish firmaga **2 oy mutlaqo bepul** pilot bering. Sharti bitta: natijani raqamda ko'rsatishga ruxsat.

**2-qadam.** Pilotdan keyin aniq raqam chiqadi. Masalan:

> "Bu firmada 2 oyda yoqilg'ida 18 mln so'm nomuvofiqlik topildi. 3 ta reys zarar bilan ishlagani aniqlandi."

**3-qadam.** Shu raqam bilan qolgan firmalarga chiqing. Sotuv gapi:

> "Dastur oyiga 1.8 mln so'm turadi. Faqat yoqilg'i nazorati oyiga 8–10 mln tejaydi. Ishlamasa — pulingizni qaytaraman."

**4-qadam.** Demo har doim **boshliqning o'z mashinalari** misolida bo'lsin. 1 ta reysni jonli kiriting va foydasini ko'rsating — bu 20 daqiqada sotadi.

## 12.3. Raqobat ustunligi

Bozordagi ko'p dasturlar faqat **GPS kuzatuv** beradi. Sizniki **pulni ko'rsatadi**. Boshliqqa mashina qayerdaligi emas, **qancha foyda qolgani** qiziq.

Uch pog'onali ustunlik:

| Raqobatchi                         | Siz                                         |
| ---------------------------------- | ------------------------------------------- |
| Mashina qayerda ekanini ko'rsatadi | Qancha foyda qolganini ko'rsatadi           |
| Ma'lumotni qo'lda kiritish kerak   | AI chek fotosidan o'zi kiritadi             |
| Hisobot izlab topish kerak         | Boshliq oddiy savol beradi, AI javob beradi |
| Muammoni odam sezishi kerak        | AI o'zi topib, sababini aytadi              |

**Demo gapi:** _"Chekni suratga oling"_ → 5 soniyada tizimda yozuv paydo bo'ladi. Bu bitta harakat boshliqni ishontiradi.

---

# 13. KUTILAYOTGAN NATIJA (mijoz uchun)

10 ta furali firma uchun:

| Ko'rsatkich          | Oldin                  | Keyin            |
| -------------------- | ---------------------- | ---------------- |
| Yoqilg'i yo'qotish   | ~15%                   | 3–5%             |
| Hisobot tayyorlash   | 2–3 kun                | Bir zumda        |
| Zararli reyslar      | Sezilmaydi             | Darhol ko'rinadi |
| Hujjat shtraflari    | Yiliga bir necha marta | 0                |
| Mijozga javob berish | Telefon qilib so'rash  | Havola yuborish  |

**Taxminiy tejov:** oyiga 8–15 mln so'm. **Dastur narxi:** 1.8 mln so'm.

---

_Ushbu TZ asosida ishlab chiquvchi jamoa aniq baho va muddat bera oladi. Har bir ekran uchun alohida dizayn-maket (Figma) tayyorlash tavsiya etiladi._
