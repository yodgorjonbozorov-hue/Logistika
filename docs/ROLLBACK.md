# TruckAI — Rollback Runbook

Deploy noto'g'ri ketdi. Bu hujjat nima qilishni aytadi.

**Birinchi qoida:** avval qaysi qatlam buzilganini aniqlang. Ilova versiyasini
qaytarish oson va xavfsiz; bazani qaytarish ma'lumot yo'qotadi. Ikkinchisini
faqat birinchisi yordam bermaganda qiling.

---

## 0. Qaysi qatlam?

```bash
curl -sS https://api.<domain>/api/v1/health/ready | jq
```

| Natija                        | Qatlam                   | Bo'lim |
| ----------------------------- | ------------------------ | ------ |
| 503, `database: down`         | PostgreSQL               | §3     |
| 503, `redis: down`            | Redis                    | §4     |
| 503, `storage: down`          | MinIO                    | §5     |
| 200, lekin ilova xato beradi  | Ilova kodi               | §1     |
| Umuman javob yo'q             | nginx / DNS / process    | §6, §7 |
| 200, lekin ma'lumot noto'g'ri | Migratsiya yoki ma'lumot | §2     |

---

## 1. Ilova rollback (eng keng tarqalgan, xavfsiz)

Migratsiyasiz deploy edi — faqat kod. Oldingi artefaktga qaytish:

**Docker:**

```bash
docker compose -f docker-compose.prod.yml stop api
docker compose -f docker-compose.prod.yml run --rm \
  -e IMAGE_TAG=<oldingi-sha> api true          # tag mavjudligini tekshirish
IMAGE_TAG=<oldingi-sha> docker compose -f docker-compose.prod.yml up -d api
```

**systemd + build artefakt:**

```bash
systemctl stop truckai-api
ln -sfn /opt/truckai/releases/<oldingi-sha> /opt/truckai/current
systemctl start truckai-api
```

Tekshirish:

```bash
curl -sS https://api.<domain>/api/v1/health/ready
bash deploy/smoke-test.sh
```

**Web (Vercel):** Vercel dashboard → Deployments → oldingi deployment →
_Promote to Production_. Yoki `vercel rollback <deployment-url>`.

> Web va API versiyalari mos kelishi kerak. API'ni qaytarsangiz, web'ni ham
> o'sha releasega qaytaring — aks holda web yangi endpointni chaqiradi va 404
> oladi.

---

## 2. Baza migratsiyasi bilan deploy edi

**Prisma'da `down` migratsiya yo'q.** Bu ataylab: avtomatik teskari
migratsiya ma'lumotni jimgina yo'qotadi. Shuning uchun yagona ishonchli yo'l —
backup'dan tiklash.

### 2.1 Migratsiya qo'shimcha edi (yangi ustun/jadval, nullable)

Ko'p hollarda **rollback kerak emas**: eski kod yangi ustunni ko'rmaydi va
ishlashda davom etadi. Faqat ilovani qaytaring (§1) va migratsiyani joyida
qoldiring.

Bu eng xavfsiz yo'l, va shuning uchun migratsiyalar iloji boricha
qo'shimcha (additive) qilib yoziladi.

### 2.2 Migratsiya buzuvchi edi (ustun o'chirilgan, tur o'zgargan)

```bash
# 1. Trafikni to'xtatish — yarim tiklangan bazaga yozish eng yomon holat
systemctl stop truckai-api

# 2. HOZIRGI holatni saqlash (migratsiyadan keyingi)
BACKUP_PASSPHRASE=… BACKUP_DIR=/backups/pre-rollback sh deploy/backup.sh

# 3. Deploydan OLDINGI backup'ni topish
ls -lt /backups/truckai_*.dump.gpg | head

# 4. DISASTER-RECOVERY.md §3.3 bo'yicha tiklash
```

Deploy va oxirgi backup orasidagi yozuvlar yo'qoladi. Aynan shu sabab
buzuvchi migratsiyadan **oldin qo'lda backup olinadi** — CI ham buni
ogohlantiradi (`Warn on potentially destructive pending migrations`).

### 2.3 Migratsiya yarmida to'xtadi

```bash
psql "$MIGRATION_DATABASE_URL" -c \
  "select migration_name, started_at, finished_at, rolled_back_at
     from _prisma_migrations order by started_at desc limit 5"
```

`finished_at IS NULL` bo'lgan qator bor — Prisma keyingi `migrate deploy` ni
bloklaydi. Migratsiya SQL'ini o'qing va nima bajarilganini aniqlang:

- **Hech narsa bajarilmagan** → qatorni o'chiring, tuzating, qayta urining:
  `prisma migrate resolve --rolled-back <migration_name>`
- **Qisman bajarilgan** → §2.2 (backup'dan tiklash). Qo'lda "tugatish"
  schema'ni migration tarixidan farqli holatga olib keladi va keyingi har bir
  deploy shu yerda yiqiladi.

---

## 3. PostgreSQL tiklanmayapti

```bash
systemctl status postgresql
journalctl -u postgresql -n 100 --no-pager
df -h                      # to'lgan disk — eng keng tarqalgan sabab
```

- **Disk to'la:** eski WAL/log tozalang, keyin ishga tushiring. Backup
  papkasini boshqa diskka ko'chiring.
- **Ma'lumot buzilgan:** DISASTER-RECOVERY.md §3.3.
- **Faqat sekin:** bu rollback emas — §8 ga qarang.

---

## 4. Redis tiklanmayapti

Redis'da tiklab bo'lmaydigan narsa yo'q (DISASTER-RECOVERY.md §4).

```bash
systemctl restart redis
redis-cli ping
```

Umuman ko'tarilmasa: ilova **`ready` bo'lmaydi** va trafik olmaydi. Bu to'g'ri
xatti-harakat — rate limiting ishlamayotgan API'ni ochiq qoldirishdan yaxshi.
Redis'ni bo'sh ma'lumotlar bilan ko'tarish mumkin:

```bash
mv /var/lib/redis/dump.rdb /var/lib/redis/dump.rdb.broken
systemctl start redis
```

Natija: barcha foydalanuvchilar qayta login qiladi.

---

## 5. MinIO tiklanmayapti

Baza va API ishlaydi; faqat fayl yuklash va ko'rish buziladi.

```bash
systemctl status minio
curl -sS http://127.0.0.1:9000/minio/health/live
```

Bucket yo'qolgan bo'lsa: `mc mb` bilan yarating (**private**), keyin offsite
nusxadan `mc mirror` qiling. Bucket mavjud bo'lmasa `health/ready` 503
qaytaradi — bu ham ataylab.

---

## 6. nginx / TLS

```bash
nginx -t                                  # konfiguratsiya sintaksisi
sh deploy/check-tls.sh api.<domain>       # sertifikat + sarlavhalar
systemctl reload nginx
```

Sertifikat muddati tugagan bo'lsa:

```bash
sh deploy/certbot.sh renew
```

nginx konfiguratsiyasini qaytarish — `git checkout <oldingi-sha> --
deploy/nginx.conf`, keyin `nginx -t && nginx -s reload`. **`nginx -t` dan
o'tmagan konfiguratsiyani hech qachon reload qilmang** — nginx eski
konfiguratsiya bilan ishlashda davom etadi, ya'ni sizga ikkinchi imkoniyat
beradi; `-t` ni o'tkazib yuborish o'sha imkoniyatni yo'qotadi.

---

## 7. DNS

DNS o'zgarishi eng sekin tiklanadigan qatlam — TTL tugaguncha kutish kerak.

- A yozuvlarini oldingi IP'ga qaytaring.
- **TTL'ni oldindan pasaytiring.** Rejalashtirilgan migratsiyadan 24 soat
  oldin TTL'ni 300 s ga tushiring; shunda rollback daqiqalarda ishlaydi,
  soatlarda emas.
- Tekshirish: `dig +short api.<domain>` va `dig +short app.<domain>`.

---

## 8. Rollback EMAS bo'lgan holatlar

| Alomat                        | Nima qilish                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Sekin, lekin to'g'ri javoblar | `node deploy/load-test.mjs` bilan o'lchang, sekin so'rovni `requestId` orqali logdan toping                               |
| Ba'zi foydalanuvchilarda 429  | Rate limit ishlayapti. Limitni ko'tarishdan oldin kim va nima uchun urayotganini aniqlang                                 |
| AI javob bermayapti           | Core'ga ta'sir qilmaydi. `GET /ai/status`; `AI_ENABLED=false` bilan o'chiring — dashboard va moliya ishlashda davom etadi |
| Bitta tenantda xato           | Rollback emas — ma'lumot muammosi. `companyId` bo'yicha logni filtrlang                                                   |

---

## 9. Rollbackdan keyin

1. `bash deploy/smoke-test.sh` — 0 fail bo'lishi shart.
2. Nima yo'qolganini yozing (agar baza tiklangan bo'lsa: qaysi vaqt oralig'i).
3. Sababni toping va **testga aylantiring** — shu vaziyat ikkinchi marta
   yuz bermasligi uchun.
4. `truckai_broken_*` bazasini bir necha kun saqlang.
