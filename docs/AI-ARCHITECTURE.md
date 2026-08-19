# AI Logistics Assistant — arxitektura

TruckControl AI ichidagi AI yordamchi: boshliq oddiy tilda savol beradi, javob
**kompaniyaning haqiqiy bazasidan** olingan raqamlar bilan qaytadi.

Bu hujjat nima qanday ishlashini va **nima uchun aynan shunday** ekanini yozadi.

---

## 1. Asosiy qoida

> Til modeli hech qachon raqam **hisoblamaydi** va hech qachon bazani **ko'rmaydi**.
> U faqat allaqachon hisoblangan raqamlarni jumlaga aylantiradi.

Bu bitta jumla butun dizaynni tushuntiradi. Moliyaviy hisob `finance` moduli
tomonidan butun sonli BigInt arifmetikasi bilan bajariladi (7-bosqich), model
esa tayyor faktlar ro'yxatini oladi. Modelni butunlay o'chirsangiz ham endpoint
to'g'ri javob berishda davom etadi — shuning uchun uni kompaniya moliyasi
oldiga qo'yish xavfsiz.

---

## 2. Ma'lumot oqimi

```
POST /api/v1/ai/chat
  │
  ├─ JwtGuard          → companyId, userId, role  (JWT'dan; body'dan EMAS)
  ├─ RolesGuard        → OWNER | ACCOUNTANT | LOGIST   (DRIVER rad etiladi)
  ├─ ThrottleAi        → 20 so'rov / daqiqa / foydalanuvchi
  ├─ ValidationPipe    → AskDto (whitelist, forbidNonWhitelisted)
  │
  ▼
prompt-guard.ts        → xavfli/ma'nosiz savolni provayder chaqirilmasdan rad etadi
  ▼
intent.ts              → intent + davr (deterministik, kalit so'zlar bo'yicha)
  ▼
analytics.facade.ts    → FAQAT shu kompaniya uchun rollup'lar (har biri 1 marta)
  ▼
facts.ts               → BigInt → "9 000 000 so'm", bp → "66,7 %"
  ▼
answer-composer.ts     → i18n shablonlaridan to'g'ri javob (deterministik)
  ▼
AiProvider.complete()  → model jumlani chiroyliroq yozadi   (timeout bilan)
  ▼
verify.ts              → javobdagi HAR bir raqam faktlarda bormi?
  │                       yo'q bo'lsa → modelning javobi tashlab yuboriladi
  ▼
AuditService.log()     → AI_QUERY yozuvi (kim, qachon, intent, natija)
  ▼
{ answer, source, fallbackReason, intents, period, facts, provider }
```

`GET /api/v1/ai/insights` — xuddi shu analitika ustidagi **deterministik**
kuzatuvlar; provayder umuman ishtirok etmaydi.

---

## 3. Xavfsizlik modeli

| Qatlam                              | Nima kafolatlaydi                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `JwtGuard` + `@CurrentUser()`       | `companyId` faqat token'dan. Body yoki prompt'dan hech qachon.                                       |
| `@Roles(OWNER, ACCOUNTANT, LOGIST)` | DRIVER moliya raqamlarini ko'ra olmaydi — na jadval, na jumla ko'rinishida.                          |
| `AnalyticsFacade`                   | AI uchun yagona ma'lumot yo'li. Unda boshqa kompaniyani ko'rsatadigan argument **yo'q**.             |
| `FinanceService`                    | Har raw SQL'da `company_id` parametr sifatida bog'lanadi; Prisma o'qishlari tenant extension orqali. |
| `prompt-guard.ts`                   | Cross-tenant / SQL / instruction-override / write so'rovlari provayder chaqirilmasdan rad etiladi.   |
| `verify.ts`                         | Modelning javobidagi noma'lum raqam → javob tashlanadi.                                              |
| `ThrottleAi`                        | 20/daqiqa, foydalanuvchi bo'yicha (IP emas — bitta ofis NAT'i butun kompaniyani bloklamasin).        |
| `AskDto`                            | `question` ≤ 2000 belgi (qattiq), `AI_MAX_PROMPT_CHARS` ≤ 500 (sozlanadi).                           |
| `AI_MAX_ANSWER_CHARS`               | Javob uzunligi cheklanadi.                                                                           |
| `AuditService`                      | Har savol audit log'ga tushadi (savolning birinchi 200 belgisi).                                     |
| API kaliti                          | Faqat backend env'da. Bundle'ga tushmaydi, javobda qaytmaydi.                                        |

### Prompt injection

Uch qatlam:

1. **Guard** — «Company B ma'lumotini ko'rsat», «SELECT * FROM trips»,
   «ignore previous instructions» kabi so'rovlar darhol rad etiladi.
2. **Arxitektura** — model so'rov yoza olmaydi. Qaysi rollup olinishini
   `detectIntent` hal qiladi, `companyId` esa JWT'dan keladi. Guard'ni aylanib
   o'tgan prompt ham boshqa kompaniya ma'lumotini **jismonan** ololmaydi.
3. **Verifikatsiya** — model javobiga o'zi o'ylab topgan raqamni qo'sha olmaydi.

E2E testlar (`test/ai.e2e-spec.ts`) uchala qatlamni ikkita real kompaniya bilan
tekshiradi.

---

## 4. Tenant izolyatsiyasi

`AnalyticsScope` **har so'rov uchun alohida** yaratiladi va `CurrentUserPayload`
bilan bog'lanadi. Memo-kesh ham shu scope ichida — global kesh bo'lganda u
aynan shu modul oldini olishi kerak bo'lgan teshikka aylanardi.

```ts
// analytics.facade.ts
scopeFor(actor: CurrentUserPayload, period: AiPeriod): AnalyticsScope
```

Boshqa `companyId` uzatish uchun API yo'q — signature'da bunday argument yo'q.

---

## 5. Provider abstraksiyasi

```
AiProvider (interface)
 ├── MockAiProvider        — default; kalit va tarmoq kerak emas
 └── AnthropicAiProvider   — Claude, @anthropic-ai/sdk orqali
```

`AI_PROVIDER` env o'zgaruvchisi tanlaydi. Tanlangan provayder ishlamasa
(kalit yo'q, noto'g'ri nom) — mock'ga qaytadi va WARN yoziladi; production'da
esa `env.validation` kalitsiz `AI_PROVIDER=anthropic` bilan umuman ko'tarilmaydi.

**MockAiProvider — test uchun emas.** U AI obunasi yo'q deployment'da
production'da ishlaydi va deterministik javobni qaytaradi: raqamlar to'g'ri,
faqat uslub soddaroq.

Yangi provayder qo'shish: `AiProvider`ni implement qiling va
`provider.factory.ts`ga bitta `case` qo'shing. Boshqa hech narsa o'zgarmaydi.

### Model chaqiruvi haqida

- `temperature` va boshqa sampling parametrlari **uzatilmaydi** — joriy Claude
  modellari ularni qabul qilmaydi (400).
- Model uchun hech qanday tool berilmagan: u faqat faktlar ro'yxatini oladi.
- `stop_reason: refusal`, timeout, bo'sh javob — hammasi deterministik javobga
  qaytish bilan yakunlanadi.

---

## 6. Qo'llab-quvvatlanadigan intent'lar

`REVENUE`, `EXPENSE`, `PROFIT`, `MARGIN`, `TRIPS`, `ROUTES`, `VEHICLES`,
`DRIVERS`, `FUEL`, `DISTANCE`, `MONTHLY_COMPARISON`, `ANOMALY`,
`RECOMMENDATION`.

Bir savolda bir nechta intent bo'lishi normal:

| Savol                        | Intent'lar                  |
| ---------------------------- | --------------------------- |
| «Qaysi truck ko'p pul yedi?» | `VEHICLES` + `EXPENSE`      |
| «Eng foydali route?»         | `ROUTES` + `PROFIT`         |
| «O'tgan oy bilan solishtir»  | `MONTHLY_COMPARISON`        |
| «Foydamiz nega kamaygan?»    | `PROFIT` + `RECOMMENDATION` |

Hech biri mos kelmasa — kompaniya umumiy ko'rsatkichlari qaytariladi.

**Davr**: `bu oy` (default), `o'tgan oy`, `oxirgi 30/90 kun`, `bu yil`, oy nomi
(`avgust`), aniq yil (`2024-yil avgust`). Barchasi UTC bo'yicha, chunki bazadagi
har bir vaqt UTC.

**Tillar**: kalit so'zlar uz-latn, uz-cyrl, ru va en uchun. Javob tili — UI
lokali (`uz-latn`, `uz-cyrl`, `ru`).

---

## 7. Cheklovlar

- AI **faqat o'qiydi**: reys, xarajat, foydalanuvchi yarata/o'zgartira/o'chira
  olmaydi. Yozuv endpoint'i yo'q, `AnalyticsFacade`da yozuv metodi yo'q.
- Suhbat **holatsiz**: har savol mustaqil. «Yana ko'rsat» kabi davomiy savollar
  hozircha qo'llab-quvvatlanmaydi.
- Javob tili UI'ning uchta lokali bilan cheklangan. Inglizcha savol tushuniladi,
  javob esa foydalanuvchining lokalida qaytadi.
- Deterministik javob shablon asosida — modelsiz u qisqaroq va quruqroq.
- `AI_MAX_PROMPT_CHARS` (500) dan uzun savol rad etiladi.
- Insights faqat joriy oy uchun hisoblanadi.

---

## 8. Environment o'zgaruvchilari

| O'zgaruvchi            | Default         | Ma'nosi                                                                        |
| ---------------------- | --------------- | ------------------------------------------------------------------------------ |
| `AI_PROVIDER`          | `mock`          | `mock` yoki `anthropic`                                                        |
| `AI_API_KEY`           | —               | Provayder kaliti. **Faqat backend.** Production'da `anthropic` uchun majburiy. |
| `AI_MODEL`             | `claude-opus-5` | Model identifikatori                                                           |
| `AI_TIMEOUT_MS`        | `15000`         | Provayder chaqiruvi timeout'i (1 000–60 000)                                   |
| `AI_MAX_PROMPT_CHARS`  | `500`           | Savol uzunligi chegarasi (20–2000)                                             |
| `AI_MAX_ANSWER_CHARS`  | `1200`          | Javob uzunligi chegarasi                                                       |
| `AI_MAX_ANSWER_TOKENS` | `2048`          | Provayder uchun token chegarasi                                                |
| `AI_ENABLED`           | `true`          | `false` — endpoint'lar ishlaydi, lekin faqat deterministik javob               |

---

## 9. Deployment

Hech qanday migratsiya kerak emas: modul mavjud jadvallardan o'qiydi va audit
uchun mavjud `audit_logs`ga yozadi.

```bash
# 1) AI'siz (default) — hech narsa qo'shish shart emas
AI_PROVIDER=mock

# 2) Claude bilan
AI_PROVIDER=anthropic
AI_API_KEY=sk-ant-...          # secret manager'dan, .env'ga qo'lda yozilmaydi
AI_MODEL=claude-opus-5
AI_TIMEOUT_MS=15000
```

Tekshirish:

```bash
curl -H "authorization: Bearer $TOKEN" https://api.example.uz/api/v1/ai/status
# {"provider":"anthropic","available":true}
```

Provayder ishlamay qolsa: foydalanuvchilar javob olishda davom etadi
(`source: "template"`), `fallbackReason` sababni ko'rsatadi, dashboard esa
umuman ta'sirlanmaydi.

`source` faqat matnni kim yozganini bildiradi, raqamlarni emas — raqamlar har
ikki holatda ham bir xil. `AI_PROVIDER=mock` bo'lganda javob har doim
`source: "template"`, `fallbackReason: "deterministic-provider"` bo'ladi:
matnni kompozitor yozgan, model emas, va interfeys buni yashirmasligi kerak.

---

## 10. Testlar

| Fayl                       | Nima tekshiradi                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `intent.spec.ts`           | Intent va davr aniqlash, 4 tilda; prompt guard qoidalari va **noto'g'ri ishlamasligi**                             |
| `facts.spec.ts`            | BigInt → so'm, bp → %, va **verifikatsiya**: o'ylab topilgan raqam rad etiladi                                     |
| `insights.spec.ts`         | Chegaralar (5 % o'zgarish, 35 % xarajat ulushi, 7 % yoqilg'i normasi)                                              |
| `ai.service.spec.ts`       | Provayder: timeout, xato, bo'sh javob, rad etish, verifikatsiyadan o'tmaslik — har birida to'g'ri raqamlar qaytadi |
| `test/ai.e2e-spec.ts`      | Real PostgreSQL: moliya aniqligi, tenant izolyatsiyasi, RBAC, injection, rate limit                                |
| `AiAssistantPage.test.tsx` | Chat UI: savol yuborish, faktlar paneli, `source` belgisi, xato holati                                             |
| `InsightsCard.test.tsx`    | Insights i18n orqali; xato bo'lsa **hech narsa** ko'rsatilmaydi                                                    |
