# TruckAI — Security

Bu hujjat qanday himoya borligini va **qayerda tekshirilganini** tasvirlaydi.
Har bir da'vo ortida ishga tushiriladigan test bor; testsiz da'vo bu yerda
"tekshirilmagan" deb belgilanadi.

---

## 1. Tahdid modeli

TruckAI — multi-tenant SaaS: bitta o'rnatmada ko'p logistika firmasi.
Eng katta zarar keltiradigan uchta narsa, tartib bo'yicha:

1. **Bir firma boshqasining ma'lumotini ko'rishi.** Raqobatchilar bir
   platformada. Narx, mijoz va marshrut — tijorat siri.
2. **Haydovchi firma pulini ko'rishi.** Haydovchi reysga qancha to'langanini
   bilmasligi kerak.
3. **Ma'lumot yo'qolishi.** Moliyaviy yozuv — buxgalteriya hujjati.

Qolganlari (mavjudlik, DoS) muhim, lekin tuzatilishi mumkin. Yuqoridagi
uchtasi tuzatilmaydi.

---

## 2. Tenant izolyatsiyasi

**Qoida:** har baza so'rovi `company_id` bo'yicha filtrlanadi. Istisno yo'q.

Bu Prisma client extension'da amalga oshirilgan (`prisma/tenant.extension.ts`):
`forCompany(companyId)` har `where` ga `company_id` qo'shadi va har `create` ga
uni yozadi. Servis kodi buni unuta olmaydi, chunki ular boshqa client'ga
umuman ega emas.

`companyId` va `userId` **hech qachon** body yoki query'dan olinmaydi — faqat
JWT'dan, `@CurrentUser()` orqali. Global `ValidationPipe` `whitelist: true` va
`forbidNonWhitelisted: true` bilan ishlaydi, ya'ni body'dagi `companyId`
e'tiborsiz qoldirilmaydi — so'rov 400 bilan rad etiladi.

AI yordamchisi uchun bu takrorlangan: `AnalyticsScope` JWT payload'idan
quriladi va **birorta metodida companyId argumenti yo'q**. Prompt qanday
bo'lishidan qat'i nazar boshqa tenantga o'tish yo'li yo'q.

**Tekshiruv:**

- `apps/backend/test/tenant-isolation.e2e-spec.ts` — 30 test, ikkita haqiqiy
  kompaniya, haqiqiy PostgreSQL. Har resurs × har fe'l matritsasi;
  cross-tenant foreign key; `companyId` ni body/query'da yuborish; AI orqali
  so'rash.
- `deploy/smoke-test.sh` — haqiqiy deploymentda, haqiqiy edge orqali.

---

## 3. Autentifikatsiya va sessiya

| Nazorat           | Amalga oshirilishi                                                      |
| ----------------- | ----------------------------------------------------------------------- |
| Parol hash        | argon2id                                                                |
| Access token      | JWT, qisqa muddat (`JWT_ACCESS_TTL`, default 15m)                       |
| Refresh token     | httpOnly + Secure + SameSite=Strict cookie, `path=/api/v1/auth`         |
| Refresh rotatsiya | Har ishlatishda yangisi beriladi                                        |
| Reuse detection   | Bekor qilingan token ko'rsatilsa — butun **oila** bekor qilinadi        |
| Sessiya holati    | Har so'rovda: foydalanuvchi faolmi, kompaniya faolmi, obuna tugamaganmi |
| Brute force       | Login 5/daqiqa, SMS kod 3/daqiqa (raqam bo'yicha ham), verify 10/daqiqa |
| Xato xabari       | "Login yoki parol noto'g'ri" — qaysi yarmi xato ekani aytilmaydi        |

Refresh token **ham** javob body'sida qaytadi: Flutter ilovasi brauzer emas va
uni platforma keystore'ida saqlaydi. Brauzer uchun cookie ustuvor — cookie
bo'lsa body'dagi qiymat e'tiborsiz qoldiriladi, aks holda sessiyani
boshqarish XSS orqali boshqarilishi mumkin bo'lardi.

**CSRF** token bilan emas, konstruksiya bilan hal qilingan: `SameSite=Strict`
cookie'ni cross-site so'rovga qo'shmaydi, va cookie faqat auth yo'llariga
scope qilingan — biznes ma'lumotini o'zgartiradigan endpoint'lar
`Authorization` sarlavhasini talab qiladi, uni esa boshqa origin qo'ya olmaydi.

**Tekshiruv:** `test/auth-security.e2e-spec.ts`, `test/rbac.e2e-spec.ts`.

---

## 4. Avtorizatsiya (RBAC)

Rollar: `SUPERADMIN`, `OWNER`, `ACCOUNTANT`, `LOGIST`, `DRIVER`.

Nazorat **backend'da**, `@Roles(...)` + global `RolesGuard`. Web ilova menyuni
ham yashiradi, lekin bu faqat UX: har DENY holati brauzer hech qachon
yubormaydigan so'rov.

Asosiy qoidalar:

- `DRIVER` moliyaviy endpoint'larga (`/finance/*`, `/incomes`, `/expenses`) va
  AI yordamchisiga kira olmaydi — AI javobi puldan iborat.
- `ACCOUNTANT` reys yarata olmaydi.
- `LOGIST` platforma endpoint'lariga kira olmaydi.
- `SUPERADMIN` tenant ma'lumotiga kirmaydi — u platformani boshqaradi.

**Tekshiruv:**

- `test/rbac.e2e-spec.ts` — endpoint × rol matritsasi.
- `test/authz-coverage.e2e-spec.ts` — **to'liqlik kafolati**: Express'da
  ro'yxatdan o'tgan har bir route sanab chiqiladi va ro'yxatda bo'lmagan yangi
  `@Public` route testni yiqitadi. Bu yangi endpoint `@Roles` siz chiqib
  ketishining oldini oladi. Kafolat haqiqatan ishlashi tajriba bilan
  tasdiqlangan: ataylab qo'shilgan public route testni yiqitdi.

---

## 5. Kirish ma'lumotini tekshirish

- Har controller kirishi DTO + `class-validator`.
- Global `ValidationPipe`: `whitelist`, `forbidNonWhitelisted`, `transform`.
- Env o'zgaruvchilar start'da sxema bilan tekshiriladi — yetishmasa yoki
  placeholder bo'lsa ilova **ko'tarilmaydi** (§9).
- AI'dan kelgan JSON ham tashqi kirish kabi tekshiriladi.

**SQL injection:** `$queryRawUnsafe` / `$executeRawUnsafe` **hech qayerda
ishlatilmagan**. Ikkita raw SQL bor va ikkalasi ham parametrlangan tagged
template.

---

## 6. Fayl yuklash

| Nazorat               | Tafsilot                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Turni aniqlash        | **Magic bytes**, `mimetype` emas — `mimetype` mijoz aytgan Content-Type                  |
| Ruxsat etilgan turlar | JPEG, PNG, WebP, PDF                                                                     |
| Hajm                  | `MAX_UPLOAD_MB` (default 15), nginx'da 20m                                               |
| Obyekt kaliti         | Server generatsiya qiladi — mijoz fayl nomi kalitga **ta'sir qilmaydi** (path traversal) |
| Bucket                | Private. Public bucket har tenantning hujjatini internetga ochadi                        |
| Yuklab olish          | Signed URL, muddati bilan. Boshqa tenantning fayli → 404                                 |
| Rasm qayta ishlash    | `sharp` orqali — buzilgan fayl 4xx, 500 emas                                             |

SVG **rad etiladi**: SVG — skript joylash mumkin bo'lgan hujjat formati, ya'ni
stored XSS vektori.

**Tekshiruv:** `test/files.e2e-spec.ts` — 11 test, jumladan JPEG niqobidagi
bajariladigan fayl, rasm ko'rinishidagi HTML/SVG, path traversal urinishi va
boshqa tenantning signed URL'i.

---

## 7. AI yordamchisi

To'liq: [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md). Xavfsizlik jihatidan:

- **Faqat o'qiydi.** Yozish yo'li yo'q, tool berilmagan, SQL yozmaydi.
- **Raqamlarni kod hisoblaydi**, model emas. Model javobidagi har raqam
  oldindan hisoblangan faktlar ro'yxati bilan solishtiriladi; notanish raqam
  bo'lsa javob **tashlab yuboriladi** va deterministik javob yuboriladi.
- **Prompt guard** ma'lumot olinishidan va provayder chaqirilishidan **oldin**
  ishlaydi: cross-tenant so'rov, raw SQL, ko'rsatmani bekor qilish, yozish
  buyrug'i — rad etiladi.
- **API kaliti hech qachon frontend bundle'ga tushmaydi.** Har build'dan keyin
  tekshiriladi.

---

## 8. Transport va sarlavhalar

`deploy/nginx.conf`:

- TLS 1.2 va 1.3 faqat. TLS 1.0/1.1 rad etiladi.
- Faqat forward-secrecy (ECDHE) shifrlari. Eski `HIGH:!aNULL:!MD5` static-RSA
  suite'larni ham qabul qilardi — ular bugungi trafikni kelajakda ochib
  bo'ladigan qiladi.
- `ssl_session_tickets off` — nginx ticket kalitini rotatsiya qilmaydi.
- HSTS, CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy, CORP, COOP.
- `server_tokens off`.
- **`application/json` gzip qilinmaydi.** Sirni (login javobidagi token) va
  hujumchi ta'sir qila oladigan matnni birga siqish — BREACH aynan shu shakl.
- Upstream'ning xavfsizlik sarlavhalari `proxy_hide_header` bilan olib
  tashlanadi: aks holda brauzer ikkita qarama-qarshi `X-Frame-Options` va
  ikki xil HSTS oladi, va qaysi biri g'olib bo'lishi brauzerga bog'liq.

**Tekshiruv:** `sh deploy/check-tls.sh <host>` — sertifikat muddati, protokol
darajasi, sarlavhalar, HTTP→HTTPS redirect.

---

## 9. Sirlar

- Repositoryda sir yo'q. Git tarixida hech qachon `.env`, kalit, sertifikat
  yoki dump qo'shilmagan (tekshirilgan).
- `.gitignore` `.env.*` (shablonlardan tashqari), `*.pem`, `*.key`, `*.crt`,
  `*.dump`, `secrets.*` ni bloklaydi.
- Productionda placeholder secret bilan ilova **ko'tarilmaydi**.
- Loglarda sir yo'q — `redact.ts` (§10).
- Backup GPG AES-256 bilan shifrlanadi; parol backup bilan bir joyda
  saqlanmaydi.

```bash
sh deploy/check-production-env.sh /etc/truckai/.env.production
```

---

## 10. Loglardagi ma'lumot

Log — javobdan boshqacha ishonch chegarasi: u agregatorga yuboriladi, support
o'qiydi, oylar saqlanadi va backup qilinadi. Javobdagi refresh token bir
so'rov yashaydi; logdagisi — qidiruv indeksidagi bir oylik sessiya.

`common/logging/redact.ts` maskalaydi: `password=`, `token=`,
`authorization: Bearer …`, JWT (belgilanmagan bo'lsa ham), connection-string
paroli, `sk-…`, `AKIA…`, PEM bloklari.

Yozilmaydi: so'rov body'si, query string, sarlavhalar, to'liq URL.
Productionda `debug`/`verbose` o'chiq.

**SMS kodlari** productionda **hech qachon** log qilinmaydi — logdagi login
kodi log o'qiy oladigan har kim uchun haqiqiy hisob ma'lumoti.

---

## 11. Rate limiting

| Endpoint                                                       | Limit                                       |
| -------------------------------------------------------------- | ------------------------------------------- |
| Login                                                          | 5 / daqiqa                                  |
| SMS kod so'rash                                                | 3 / daqiqa (+ raqam bo'yicha alohida limit) |
| SMS kod tekshirish                                             | 10 / daqiqa                                 |
| Refresh                                                        | 30 / daqiqa                                 |
| AI chat                                                        | 20 / daqiqa                                 |
| Fayl yuklash                                                   | 30 / daqiqa                                 |
| Hisob amallari (foydalanuvchi yaratish/o'zgartirish/o'chirish) | 10 / daqiqa                                 |
| GPS ingest                                                     | 120 / daqiqa                                |
| Public tracking                                                | 60 / daqiqa                                 |
| Qolganlari                                                     | `RATE_LIMIT_MAX` (default 300) / daqiqa     |

Autentifikatsiya qilingan trafik **har foydalanuvchi** bo'yicha hisoblanadi —
bir ofis NAT'i ortidagi bitta kompaniya boshqasini bloklamasligi uchun.
Hisoblagichlar **Redis'da**, ya'ni limit replikalar orasida umumiy.

Har 429 `Retry-After` bilan qaytadi. nginx'ning o'z 429'i ham loyihaning
`{ success, error }` konvertida javob beradi — mijoz uni parse qila olishi
uchun.

---

## 12. Bog'liqliklar

`pnpm audit --prod` muntazam. Bir xil major ichida tuzatiladigan zaifliklar
`pnpm.overrides` orqali yopiladi.

Major versiya sakrashini talab qiladigan (masalan `@nestjs/core` 10 → 11)
zaifliklar majburan yangilanmaydi — buzuvchi yangilanish o'zi xavf. Ular
kuzatiladi va rejalashtirilgan yangilanishda hal qilinadi. Har biri uchun
runtime'ga yetib boradimi degan savolga aniq javob bo'lishi kerak.

---

## 13. Zaiflik topsangiz

Public issue ochmang. Repository egasiga to'g'ridan-to'g'ri yozing:
qanday takrorlash, ta'sir doirasi, va qaysi versiyada topilgani.
