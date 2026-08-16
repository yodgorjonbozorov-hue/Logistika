# Pilot firmani ishga tushirish qo'llanmasi

> TZ §12.2: pilot — 2 ta firma, 2 oy bepul. Maqsad: 2 oy ichida firma tizimsiz
> ishlashni xohlamay qolishi. Bu hujjat shu 2 oyni qanday olib borishni yozadi.

## 0. Kimga mos keladi

| Mezon             | Mos                                      | Mos emas                              |
| ----------------- | ---------------------------------------- | ------------------------------------- |
| Texnika soni      | 5–40                                     | 3 tadan kam (Excel yetadi), 60+ (ERP) |
| Reys turi         | Xalqaro yoki uzoq ichki                  | Faqat shahar ichi kuryerlik           |
| Boshliq           | Raqamga qaraydi, o'zi qaror qabul qiladi | «Hisobotni buxgalter ko'radi»         |
| Haydovchi telefon | Android, internet bor                    | Tugmali telefon                       |

Mos kelmasa — pilotga olmang. Ikki oy behuda ketadi va salbiy taassurot qoladi.

## 1. Boshlashdan oldin (1-kun, ~2 soat)

Firmadan quyidagilarni bir faylda so'rang:

- Texnika ro'yxati: davlat raqami, marka/model, yili, **norma l/100 km**,
  joriy probeg, sug'urta va texko'rik muddatlari
- Haydovchilar: F.I.Sh., telefon, guvohnoma raqami va muddati,
  **ish haqi turi** (fiks / foiz / km bo'yicha) va qiymati
- Doimiy mijozlar: nomi, to'lov shartlari (necha kun)
- Mashina sotib olingan narxi va rejalashtirilgan umumiy probegi
  (amortizatsiya uchun — TZ §6; bo'lmasa, foyda hisobida amortizatsiya 0 bo'ladi)

> **Eng ko'p uchraydigan xato:** norma l/100 km ni «taxminan» aytishadi. Norma
> noto'g'ri bo'lsa, yoqilg'i nazorati (W-8) ham, haydovchi reytingi ham
> ma'nosiz bo'ladi. Norma — pasportdagi yoki oxirgi 3 oy o'rtacha real sarf.

## 2. Tizimni ko'tarish

```bash
cp .env.example .env      # qiymatlarni to'ldiring (pastdagi jadvalga qarang)
docker compose up -d      # postgres, redis, minio
pnpm install
pnpm --filter backend prisma migrate deploy
pnpm --filter backend seed   # ixtiyoriy: demo firma (login ekranda ko'rsatiladi)
pnpm build && pnpm start
```

Minimal to'ldiriladigan env qiymatlari:

| O'zgaruvchi                    | Nima uchun                                    |
| ------------------------------ | --------------------------------------------- |
| `DATABASE_URL`, `JWT_*_SECRET` | Majburiy — bu yo'q bo'lsa ilova ko'tarilmaydi |
| `MINIO_*`                      | Foto va hujjatlar saqlanishi uchun            |
| `ANTHROPIC_API_KEY`            | AI funksiyalari; bo'sh bo'lsa ham ishlaydi    |
| `TELEGRAM_BOT_TOKEN`           | Boshliqqa kunlik xulosa                       |
| `SMS_PROVIDER_*`               | Haydovchi telefon+SMS bilan kirishi uchun     |

`pnpm --filter backend seed` — demo firma yaratadi (`Demo Logistika (seed)`).
Uni pilot firma bilan **aralashtirmang**: demo alohida tenant, ko'rsatish uchun.

## 3. Firmani kiritish (1-kun, ~1 soat)

1. Superadmin `POST /admin/companies` orqali firmani va birinchi OWNER ni yaratadi.
2. OWNER kiradi va **W-11 Sozlamalar** da:
   - til va vaqt mintaqasini tanlaydi;
   - yoqilg'i chegarasini kelishadi (default 7% — birinchi oyda tegmang);
   - kunlik xulosa vaqtini qo'yadi va Telegram chatini ulaydi.
3. Logist W-5/W-6/W-7 da texnika, haydovchi va mijozlarni kiritadi.
4. Har haydovchiga telefon raqami bo'yicha kirish beriladi; mobil ilova
   o'rnatiladi va **bitta sinov reysi** birga o'tkaziladi.

## 4. Birinchi hafta — faqat bitta odat

Birinchi haftada **hamma funksiyani** o'rgatmang. Bitta odat:

> Har quyish — ilovada «Quyildi» tugmasi + chek fotosi.

Boshqasi keyin. Bu bitta odat W-8 (yoqilg'i nazorati) ni ishga tushiradi, va
aynan shu ekran birinchi haftadayoq pul ko'rsatadi.

Nazorat: har kuni kechqurun logist `W-8 → Jurnal` ni ochib, quyishlar
kiritilganini tekshiradi. Kiritilmagan bo'lsa — haydovchiga o'sha kuni aytiladi,
ertasiga emas.

## 5. Ikkinchi–to'rtinchi hafta

| Hafta | Qo'shiladi                              | Qanday tekshiriladi                        |
| ----- | --------------------------------------- | ------------------------------------------ |
| 2     | 10 ta status tugmasi to'liq             | W-2 xaritada har mashina ranggi to'g'rimi  |
| 3     | Xarajatlar (yo'l boji, bojxona, ta'mir) | W-4 moliya tabida reys foydasi chiqadimi   |
| 4     | Mijoz to'lovlari, qarzdorlar (W-7)      | Qarzdorlar ro'yxati haqiqatga mos keladimi |

Har hafta oxirida boshliq bilan 20 daqiqa: **W-1 dashboard** ni birga ochib,
«bu raqam to'g'rimi?» deb so'rang. Noto'g'ri raqam — deyarli har doim
kiritilmagan xarajat yoki noto'g'ri norma.

## 6. Ikkinchi oy — AI va qaror

- AI-2 (chek OCR) yoqiladi: haydovchi endi faqat foto tashlaydi.
- Tungi anomaliya skani ishlay boshlaydi — W-10 da «AI topgan» kartochkasi.
- Kunlik xulosa Telegramga tushadi.

Ikkinchi oy oxirida ikkita raqam tayyor bo'lishi kerak:

1. **Yoqilg'i farqi** — pilot boshidagi va oxiridagi foiz.
2. **Zarar keltirgan reyslar soni** — birinchi va ikkinchi oy.

Sotuv suhbati aynan shu ikki raqam ustida quriladi, «funksiyalar» ustida emas.

## 7. Nima bo'lsa pilot muvaffaqiyatsiz deb hisoblanadi

- Haydovchilar 2 haftadan keyin ham tugma bosmayapti → jarayon muammosi,
  dastur muammosi emas. Boshliq bilan gaplashing, dasturga funksiya qo'shmang.
- Boshliq W-1 ni ochmayapti → unga kerak emas ekan. To'xtating.
- Ma'lumot kiritilgan, lekin raqamlarga ishonch yo'q → normani va
  xarajat kategoriyalarini qaytadan ko'rib chiqing.

## 8. Pilotdan keyin

Ma'lumot firmaniki. Chiqarish: W-9 hisobotlarini `xlsx`/`csv` ga eksport
qilish; hujjat va foto fayllari MinIO buketidan olinadi. Bu shartni oldindan
aytib qo'ying — ishonchni aynan shu narsa quradi.
