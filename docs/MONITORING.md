# TruckAI — Monitoring

Monitoring ikki savolga javob beradi: **ishlayaptimi** va **nima bo'ldi**.
Birinchisi — probe'lar, ikkinchisi — loglar.

---

## 1. Health probe'lar

Liveness va readiness **boshqa-boshqa savollar** va bitta javobni bo'lishmasligi
kerak. Bir vaqtlar bitta `{ status: 'ok' }` bor edi va u baza yonayotganda ham
yashil qolardi: orkestrator buzilgan pod'ga trafik yuborishda davom etardi va
hech narsani qayta ishga tushirmasdi.

| Endpoint                   | Savol                      | Bog'liqlikka tegadimi        | Kim so'raydi                  |
| -------------------------- | -------------------------- | ---------------------------- | ----------------------------- |
| `GET /api/v1/health/live`  | Process tirikmi?           | **Yo'q**                     | Orkestrator — restart qarori  |
| `GET /api/v1/health/ready` | Hozir xizmat qila oladimi? | Ha: PostgreSQL, Redis, MinIO | Load balancer — trafik qarori |
| `GET /api/v1/health`       | `ready` bilan bir xil      | Ha                           | Eski uptime monitorlar        |

`live` hech qachon bog'liqlikka tegmaydi — sekin baza sog'lom pod'ni restart
tsikliga tushirmasligi uchun. `ready` 503 qaytarsa: **trafik yubormang, lekin
o'ldirmang** — bog'liqlik tiklanishi mumkin.

```bash
curl -sS https://api.<domain>/api/v1/health/ready | jq
```

```json
{
  "success": true,
  "data": {
    "ready": true,
    "checks": {
      "database": { "status": "up", "latencyMs": 7 },
      "redis": { "status": "up", "latencyMs": 5 },
      "storage": { "status": "up", "latencyMs": 8 }
    }
  }
}
```

Har tekshiruvda 3 soniyalik timeout bor — osilgan bog'liqlik probe'ning o'zini
osib qo'ymasligi uchun.

**Probe'lar rate limit qilinmaydi** (`@SkipThrottle`): 429 "nosog'lom" deb
o'qiladi va sog'lom pod'larni restart qiladi. Ular o'rniga nginx'da faqat ichki
tarmoqqa ochiq — internetdan `/health` bog'liqliklar ro'yxatini bermaydi.

### Orkestrator sozlamasi

```yaml
livenessProbe:
  httpGet: { path: /api/v1/health/live, port: 3000 }
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /api/v1/health/ready, port: 3000 }
  periodSeconds: 5
  failureThreshold: 2
```

---

## 2. Strukturali loglar

Productionda har so'rov **bitta JSON qatori** yozadi:

```json
{
  "level": "info",
  "msg": "request",
  "requestId": "51ba6c6c-…",
  "method": "GET",
  "route": "/api/v1/finance/summary",
  "statusCode": 200,
  "durationMs": 22,
  "userId": "cbb4b8e5-…",
  "companyId": "397426c6-…",
  "time": "2026-08-20T04:56:41.519Z"
}
```

Development'da o'sha ma'lumot odam o'qiydigan qatorda chiqadi.

### Nima YOZILMAYDI — va nima uchun

|                | Sabab                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| So'rov body'si | `POST /auth/login` body'si — parol                                                                                                   |
| Query string   | Public tracking havolasining tokeni — qobiliyat (capability)                                                                         |
| Sarlavhalar    | `authorization` — bearer token                                                                                                       |
| **To'liq URL** | `/trips/<uuid>` — path parametrlari ko'pincha tenantning o'z identifikatorlari. Log **route shabloni**ni yozadi: `/api/v1/trips/:id` |

Bundan tashqari `common/logging/redact.ts` har log qatorini filtrlaydi:
`password=`, `token=`, connection-string paroli, `Bearer <token>`, JWT, `sk-…`,
`AKIA…`, PEM bloklari — hammasi `[REDACTED]` ga aylanadi. Bu exception
loglariga ham tegishli: stack frame'larda connection string paydo bo'lishi
odatiy hol.

Productionda `debug` va `verbose` darajalari **o'chiq** — aynan ular
argumentlarni bosib chiqaradi.

### requestId

Har javobda `X-Request-Id` sarlavhasi qaytadi. Foydalanuvchi shikoyat qilganda
undan shu id'ni so'rang — bitta so'rovga tegishli hamma narsa (jumladan
xizmat ichidagi xatolar) shu id bilan belgilangan.

Upstream proxy `X-Request-Id` yuborsa, u **tekshirilib** qabul qilinadi
(`^[A-Za-z0-9._-]{8,64}$`) — mijoz boshqaradigan matn logga tushayotgani uchun.
Yangi qator belgisi bo'lgan qiymat rad etiladi va o'rniga o'z UUID'i beriladi;
aks holda mijoz logga soxta qator "yozishi" mumkin edi.

### Log rotatsiyasi

Ilova stdout'ga yozadi. Rotatsiya — process menejerining ishi:

```
# /etc/logrotate.d/truckai
/var/log/truckai/*.log {
  daily
  rotate 30
  compress
  delaycompress
  missingok
  notifempty
  copytruncate
}
```

Docker uchun:

```yaml
logging:
  driver: json-file
  options: { max-size: '50m', max-file: '10' }
```

---

## 3. Nimani kuzatish kerak

### Xizmat

| Signal         | Manba                   | Ogohlantirish chegarasi        |
| -------------- | ----------------------- | ------------------------------ |
| API mavjudligi | `/health/live`          | 3 ketma-ket muvaffaqiyatsizlik |
| API tayyorligi | `/health/ready`         | 2 ketma-ket 503                |
| PostgreSQL     | `ready.checks.database` | `down`, yoki `latencyMs > 500` |
| Redis          | `ready.checks.redis`    | `down`                         |
| MinIO          | `ready.checks.storage`  | `down`                         |

### Resurslar

| Signal           | Buyruq                                  | Chegaralar                                                              |
| ---------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| CPU              | `top`, cAdvisor                         | > 80% davomiy 5 daqiqa                                                  |
| RAM (RSS)        | `ps -o rss= -p <pid>`                   | O'sib borish trendi — bir martalik cho'qqi emas                         |
| Disk             | `df -h`                                 | < 15% bo'sh. **Baza va backup uchun eng keng tarqalgan avariya sababi** |
| Baza ulanishlari | `select count(*) from pg_stat_activity` | Pool cheklovining 80%                                                   |

> Yuklama testida (staging, 30 parallel, ~270k so'rov) RSS 181 MB → ~360 MB
> ga chiqib **barqarorlashdi**, ulanishlar 10 da qoldi. O'sib boruvchi RSS —
> sizib chiqish alomati; bir marta ko'tarilib tekislanishi — ish to'plami.

### Sekin so'rovlar

```sql
-- pg_stat_statements yoqilgan bo'lsa
SELECT calls, round(mean_exec_time::numeric,1) AS ms, left(query,80)
FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
```

Loglardan:

```bash
jq -r 'select(.durationMs > 500) | "\(.durationMs)ms \(.route) \(.requestId)"' app.log
```

### Xavfsizlik signallari

| Signal                                  | Log filtri                                                    | Nimani anglatadi                                                             |
| --------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Autentifikatsiya muvaffaqiyatsizliklari | `.statusCode == 401` cho'qqisi                                | Parol tanlash urinishi                                                       |
| Rate limit                              | `.statusCode == 429` cho'qqisi                                | Hujum yoki buzilgan mijoz                                                    |
| 5xx                                     | `.level == "error"`                                           | Ilova nosozligi                                                              |
| Refresh reuse                           | `audit_logs.action = 'REFRESH_REUSE_DETECTED'`                | **O'g'irlangan sessiya** — tekshiring                                        |
| AI rad javoblari                        | `fallbackReason` `refused:` bilan boshlanadi                  | Prompt injection urinishi                                                    |
| Tekshirilmagan AI raqami                | Log: `Discarded an AI answer containing unverifiable figures` | Model raqam o'ylab topdi — javob tashlandi. **Nolga teng bo'lishi kutiladi** |

```bash
jq -r 'select(.statusCode==401) | .time' app.log | uniq -c   # 401 tezligi
jq -r 'select(.statusCode>=500) | "\(.time) \(.route) \(.requestId)"' app.log
```

### Backup

```bash
# Cron: har kuni. Muvaffaqiyatsizlikda non-zero → cron mail / alert
BACKUP_PASSPHRASE=… SOURCE_URL=… sh deploy/backup-verify.sh
```

Kuzatilishi kerak: backup **yoshi** (48 soatdan katta bo'lsa cron ishlamayapti)
va tekshiruv natijasi.

### Sertifikat muddati

```cron
# Har kuni 06:11 — 21 kundan kam qolganda non-zero qaytaradi
11 6 * * *  /bin/sh /opt/truckai/deploy/check-tls.sh api.<domain>
```

Sertifikat shanba kuni tugasa mahsulot dushanbagacha o'chiq turadi — shuning
uchun ogohlantirish chegarasi renewal oynasidan (30 kun) kichik, lekin
qo'lda aralashish uchun yetarli (21 kun).

---

## 4. Alert qilishga arzimaydigan narsalar

- Bitta 500. Bittasi shovqin; tezlik — signal.
- Bitta 429. Limiter ishlayapti.
- AI provayder timeout'i. Fallback ishlaydi, foydalanuvchi baribir to'g'ri
  raqamlarni oladi.
- Deploy paytidagi qisqa `ready: false`. Kutilgan holat.
