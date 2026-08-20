# TruckAI — mijozga topshirish

Bu hujjat ikki savolga javob beradi: **serverga qanday o'rnatiladi** va
**mijozga kirish qanday beriladi**.

Texnik tafsilotlar: [PRODUCTION.md](PRODUCTION.md) ·
[DEPLOYMENT.md](DEPLOYMENT.md) · nosozlikda [ROLLBACK.md](ROLLBACK.md).

---

## 1. Sizdan nima kerak

Kod tayyor va tekshirilgan. Uchta narsa faqat sizda bo'ladi:

| #   | Kerak                                                                          | Nima uchun                                            |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 1   | **Server** — Ubuntu 22.04+, 2 vCPU / 4 GB RAM / 40 GB disk, Docker o'rnatilgan | Butun stack shu yerda ishlaydi                        |
| 2   | **Domen** — masalan `truckai.uz`, A yozuvi server IP'siga qaratilgan           | HTTPS sertifikati DNS orqali tasdiqlanadi             |
| 3   | **Email** — `admin@truckai.uz` kabi                                            | Let's Encrypt sertifikat muddati haqida shunga yozadi |

5–40 mashinali firma uchun eng arzon VPS ham yetadi.

---

## 2. O'rnatish — bitta buyruq

```bash
git clone https://github.com/yodgorjonbozorov-hue/Logistika.git /opt/truckai
cd /opt/truckai
sudo bash deploy/go-live.sh --domain truckai.uz --email admin@truckai.uz
```

Skript ketma-ket bajaradi:

1. Talablarni tekshiradi va **DNS to'g'ri qaratilmagan bo'lsa to'xtaydi**
   (noto'g'ri urinish Let's Encrypt limitidan bitta imkoniyat yeydi).
2. `.env.production` faylini haqiqiy, tasodifiy sirlar bilan yaratadi
   (`chmod 600`). Qayta ishga tushirilsa sirlarni **qayta yaratmaydi**.
3. Baza mavjud bo'lsa — **migratsiyadan oldin backup oladi**.
4. Web bundle'ni shu deploymentning o'z manziliga qarab quradi.
5. Stack'ni ko'taradi: migratsiya bir marta ishlaydi, keyin API boshlanadi.
6. TLS sertifikatini oladi va avtomatik yangilanishni o'rnatadi.
7. Birinchi administratorni yaratadi va **parolni bir marta ko'rsatadi**.
8. Smoke testni ishga tushiradi va biror tekshiruv yiqilsa muvaffaqiyat
   deb e'lon **qilmaydi**.

Avval ko'rish uchun: `--dry-run` qo'shing — hech narsa o'zgarmaydi.

### Ikki variant

```bash
--mode single-server   # standart: web + API bitta domenda, bitta sertifikat
--mode api-only        # web Vercel'da, API serverda (api.<domen>)
```

`single-server` odatda to'g'ri tanlov: bitta server, bitta sertifikat, tashqi
akkaunt kerak emas. U **xavfsizroq** ham — web va API bir origin bo'lgani
uchun CORS umuman kerak emas va cookie first-party bo'ladi.

---

## 3. Mijozga kirish qanday beriladi

Administrator (siz) mijoz uchun **kompaniya yaratasiz**. Har kompaniya butunlay
alohida: bir firma boshqasining ma'lumotini hech qachon ko'rmaydi.

```bash
# 1. Administrator sifatida kiring
TOKEN=$(curl -s -X POST https://truckai.uz/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"identifier":"admin@truckai.uz","password":"<o'\''rnatishda berilgan parol>"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')

# 2. Mijoz firmasini va uning rahbarini yarating
curl -s -X POST https://truckai.uz/api/v1/admin/companies \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{
    "name": "Mijoz Logistika MChJ",
    "owner": {
      "fullName": "Firma Rahbari",
      "email": "rahbar@mijoz.uz",
      "password": "<kuchli parol>"
    }
  }'
```

Mijozga beriladigan narsa:

```
Manzil:  https://truckai.uz
Login:   rahbar@mijoz.uz
Parol:   <yuqorida bergan parol>
```

Rahbar kirgandan keyin **o'zi** xodim qo'shadi: `Foydalanuvchilar` bo'limida
logist, buxgalter va haydovchi yaratadi. Siz bunga aralashmaysiz.

### Rollar

| Rol          | Nima ko'radi                                              |
| ------------ | --------------------------------------------------------- |
| `OWNER`      | Hammasi — pul, reyslar, xodimlar, AI                      |
| `ACCOUNTANT` | Moliya va hisobotlar; reys yarata olmaydi                 |
| `LOGIST`     | Reyslar, mashinalar, haydovchilar; tizim sozlamalari yo'q |
| `DRIVER`     | Faqat o'z reyslari. **Pulni umuman ko'rmaydi**            |

Haydovchining pulni ko'rmasligi backend darajasida ta'minlangan — menyuni
yashirish bilan emas.

---

## 4. O'rnatishdan keyin darhol

```bash
# 1. Administrator parolini parol menejeriga yozing
# 2. Backup parolini BOSHQA joyda saqlang:
sudo grep BACKUP_PASSPHRASE /opt/truckai/.env.production
#    Bu yo'qolsa hech bir backup ochilmaydi.

# 3. Birinchi backup'ni oling va HAQIQATAN tiklab ko'ring:
cd /opt/truckai
sudo docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec backup sh /usr/local/bin/backup.sh

# 4. Offsite nusxani yoqing (server yo'qolsa backup ham yo'qolmasligi uchun):
sudo sed -i 's#^BACKUP_S3_TARGET=.*#BACKUP_S3_TARGET=<mc-alias>/truckai-backups#' .env.production
```

Kunlik backup avtomatik ishlaydi (`backup` xizmati, 02:00 UTC).

---

## 5. Kundalik ish

```bash
cd /opt/truckai

# Holat
sudo docker compose -f docker-compose.prod.yml --env-file .env.production ps
curl -s https://truckai.uz/api/v1/health/ready | python3 -m json.tool

# Loglar (har so'rov bitta JSON qatori — sirlar maskalangan)
sudo docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api

# Yangi versiya
git pull
sudo bash deploy/go-live.sh --domain truckai.uz --email admin@truckai.uz
```

`go-live.sh` qayta ishga tushirilishi xavfsiz: sirlarni saqlaydi, backup oladi,
faqat kutilayotgan migratsiyalarni qo'llaydi, mavjud ma'lumotga tegmaydi.

---

## 6. AI yordamchisi

Standart holatda `AI_PROVIDER=mock`: **kalit ham, internet ham kerak emas**, va
yordamchi baribir to'g'ri raqamlar bilan javob beradi — chunki raqamlarni
model emas, moliya kodi hisoblaydi.

Tabiiy tilda javob xohlasangiz:

```bash
sudo sed -i 's/^AI_PROVIDER=.*/AI_PROVIDER=anthropic/' .env.production
sudo sed -i 's#^AI_API_KEY=.*#AI_API_KEY=<kalit>#' .env.production
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d api
```

Kalit **hech qachon** brauzerga tushmaydi — web ilova faqat o'z backend'i bilan
gaplashadi.

O'chirish uchun: `AI_ENABLED=false`. Dashboard va moliya ishlashda davom etadi.

---

## 7. Nima tekshirilgan, nima yo'q

|                                                              | Holat                                              |
| ------------------------------------------------------------ | -------------------------------------------------- |
| Mijoz yo'li: login → reys → xarajat → moliya → AI (21 qadam) | **21/21 PASS** — haqiqiy production URL orqali     |
| Infratuzilma smoke (104 tekshiruv)                           | **104/104 PASS**                                   |
| Brauzer: 375 / 768 / 1440 px                                 | **25/25 PASS**                                     |
| Brauzer: haqiqiy deploymentga qarshi 5 test                  | **5/5 PASS**                                       |
| Backup → restore → raqamlar mosligi                          | **PASS**                                           |
| Yuklama: 5xx                                                 | **0**                                              |
| Loglarda sir                                                 | **yo'q**                                           |
| Docker image qurilishi                                       | **TEKSHIRILMAGAN** — bu muhitda Docker demoni yo'q |
| Haqiqiy domen va Let's Encrypt sertifikati                   | **TEKSHIRILMAGAN** — domen kerak                   |
| Flutter haydovchi ilovasi qurilmada                          | **TEKSHIRILMAGAN** — toolchain/qurilma yo'q        |

Oxirgi uchtasi birinchi haqiqiy deployda tabiiy ravishda tekshiriladi —
`go-live.sh` ularning har birida to'xtaydi va sababini aytadi.

---

## 8. Muammo bo'lsa

```bash
curl -s https://truckai.uz/api/v1/health/ready | python3 -m json.tool
```

Javob qaysi bog'liqlik yiqilganini aytadi. Keyin
[ROLLBACK.md](ROLLBACK.md) — u qatlam bo'yicha tartiblangan.

Ma'lumot yo'qolgan bo'lsa: [DISASTER-RECOVERY.md](DISASTER-RECOVERY.md) §3.
