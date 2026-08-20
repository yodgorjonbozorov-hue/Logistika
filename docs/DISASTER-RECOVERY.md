# TruckAI — Disaster Recovery

Bu hujjatdagi har bir buyruq haqiqatan ishga tushirilgan va natijasi
tekshirilgan. Backup'ni birinchi marta avariya paytida sinab ko'rmang.

---

## 1. RPO va RTO

|                              | Qiymat        | Nimadan kelib chiqadi                                               |
| ---------------------------- | ------------- | ------------------------------------------------------------------- |
| **RPO** (ma'lumot yo'qotish) | **≤ 24 soat** | Kunlik to'liq backup. Oxirgi backup'dan keyingi yozuvlar yo'qoladi. |
| **RTO** (tiklanish vaqti)    | **≤ 1 soat**  | O'lchangan restore vaqti + qo'lda qadamlar (pastda).                |

**RPO'ni yaxshilash.** 24 soat 40 mashinalik firma uchun bir kunlik reys va
chek ma'lumoti. Kamaytirish uchun: backup'ni tez-tez oling (`cron` da har 6
soat) yoki PostgreSQL WAL arxivlashni yoqing (point-in-time recovery, RPO
daqiqalarga tushadi). Ikkalasi ham disk va konfiguratsiya talab qiladi —
bu qaror biznesniki, kod o'zgarishi emas.

**RTO qanday hisoblandi.** Staging'da o'lchangan (2026-08-20):

| Qadam                                           | O'lchangan |
| ----------------------------------------------- | ---------- |
| Backup butunligini tekshirish (sha256)          | < 1 s      |
| Decrypt + `pg_restore` (22 jadval, 38 KB arxiv) | **1 s**    |
| API'ni tiklangan bazaga ulab ko'tarish          | ~10 s      |
| Tekshiruv (finance + AI + tenant izolyatsiya)   | ~30 s      |

Restore vaqti ma'lumot hajmiga chiziqli bog'liq. Haqiqiy RTO'ni bilish uchun
`backup-verify.sh` chiqishidagi `restored in Ns` qatorini o'z bazangizda
o'qing — u har hafta yangilanadi va taxmin emas.

Qolgan vaqt qo'lda bajariladigan qadamlar: qaror qabul qilish, DNS/deployment
o'zgarishi, ma'lumot yo'qolganini tasdiqlash. 1 soatlik RTO shularni
o'z ichiga oladi.

---

## 2. Backup nima va qayerda

```
truckai_<YYYYMMDD>_<HHMMSSZ>.dump.gpg          ← GPG AES-256, symmetric
truckai_<YYYYMMDD>_<HHMMSSZ>.dump.gpg.sha256   ← butunlik
```

- `pg_dump --format=custom` — siqilgan, `pg_restore` tanlab tiklay oladi.
- **Shifrlash diskka yozishdan oldin.** Backup — har bir tenantning to'liq
  nusxasi; shifrlanmagani noto'g'ri sozlangan huquqni kutib turgan sizib
  chiqish.
- `BACKUP_PASSPHRASE` — **backup bilan bir serverda saqlanmaydi**. Yo'qolsa
  hech bir backup ochilmaydi.
- `BACKUP_S3_TARGET` — offsite nusxa. Bo'sh bo'lsa backup faqat shu serverda
  qoladi, ya'ni server yo'qolsa backup ham yo'qoladi. Skript bu haqda
  ogohlantiradi.
- Saqlash muddati: `BACKUP_RETENTION_DAYS` (default 30). Eski nusxalar faqat
  **yangi, tekshirilgan, shifrlangan** backup muvaffaqiyatli yozilgandan keyin
  o'chiriladi.

### Cron

```cron
# Har kuni 02:17 UTC — to'liq backup
17 2 * * *  BACKUP_PASSPHRASE=... /bin/sh /opt/truckai/deploy/backup.sh >> /var/log/truckai-backup.log 2>&1

# Har yakshanba 03:40 UTC — haqiqiy restore rahearsal
40 3 * * 0  BACKUP_PASSPHRASE=... SOURCE_URL=postgresql://.../truckai /bin/sh /opt/truckai/deploy/backup-verify.sh >> /var/log/truckai-restore-check.log 2>&1
```

`backup-verify.sh` muvaffaqiyatsizlikda non-zero qaytaradi — cron mail yoki
alert wrapper buni ushlaydi.

---

## 3. Restore — qadamma-qadam

### 3.1 Alohida bazaga (rahearsal yoki tekshiruv)

```bash
export BACKUP_PASSPHRASE='…'

# 1. Butunlik
sha256sum -c /backups/truckai_20260820_050133Z.dump.gpg.sha256

# 2. Bo'sh baza
psql "$ADMIN_URL" -c "CREATE DATABASE truckai_restore"

# 3. Restore
sh deploy/restore.sh /backups/truckai_20260820_050133Z.dump.gpg \
   "postgresql://postgres@127.0.0.1:5432/truckai_restore"
```

`restore.sh` o'zi tekshiradi: sha256, jadvallarda qator soni, migration
tarixi, tenant-xavfsizlik indekslari. Jadvali bor bazaga yozishdan **bosh
tortadi** — `RESTORE_ALLOW_OVERWRITE=true` aniq berilmasa.

### 3.2 Hammasini bir buyruq bilan tekshirish

```bash
BACKUP_PASSPHRASE=… SOURCE_URL="$DATABASE_URL" sh deploy/backup-verify.sh
```

Chiqishi (staging'da haqiqiy natija):

```
  ok    backup age 0h
  ok    sha256 matches
  ok    restored in 1s
  ok    migration history restored (4 applied)
  ok    all 22 tables present
  ok    index trips_one_active_per_driver restored
  ok    companies: 14 rows          ... har jadval
  ok    agreed revenue total identical (6300000000)
  ok    expenses total identical (2220000000)
  ok    fuel cost total identical (2647316)
  ok    no row belongs to a different company than its parent
  RESTORE VERIFIED — this backup is recoverable.
```

### 3.3 Production'ni tiklash (haqiqiy avariya)

> **Avval to'xtating.** Ishlab turgan bazaga restore qilish — "tiklanish"ni
> haqiqiy avariyaga aylantirish usuli.

```bash
# 1. Trafikni to'xtatish
systemctl stop truckai-api          # yoki: docker compose stop api

# 2. HOZIRGI holatni saqlash — buzilgan bo'lsa ham. Ikkinchi imkoniyat.
BACKUP_PASSPHRASE=… BACKUP_DIR=/backups/pre-restore sh deploy/backup.sh

# 3. Yangi nomli bazaga tiklash (eskisini o'chirmasdan)
psql "$ADMIN_URL" -c "CREATE DATABASE truckai_recovered"
sh deploy/restore.sh /backups/<eng-yangi>.dump.gpg \
   "postgresql://…/truckai_recovered"

# 4. Tiklangan bazani TEKSHIRISH (API'ni unga ulab)
#    Rollarni qayta yaratish kerak — dump rollarni olib yurmaydi:
psql -d truckai_recovered -v app_password="'…'" -v migrator_password="'…'" \
     -f deploy/postgres-roles.sql

# 5. Almashtirish
psql "$ADMIN_URL" -c "ALTER DATABASE truckai RENAME TO truckai_broken_$(date -u +%Y%m%d)"
psql "$ADMIN_URL" -c "ALTER DATABASE truckai_recovered RENAME TO truckai"

# 6. Ko'tarish va tasdiqlash
systemctl start truckai-api
curl -sS https://api.<domain>/api/v1/health/ready
bash deploy/smoke-test.sh
```

**`truckai_broken_*` bazasini darhol o'chirmang.** Bir necha kun turgani —
restore noto'g'ri backup'dan bo'lgan bo'lsa yagona yo'l.

---

## 4. Boshqa komponentlar

### MinIO / S3 — hujjatlar va chek fotolari

PostgreSQL backup'i fayllarni **o'z ichiga olmaydi** — bazada faqat obyekt
kalitlari bor. Fayllar alohida ko'chiriladi:

```bash
mc mirror --overwrite minio/truckai s3://offsite-bucket/truckai-files/
```

Restore: teskari yo'nalishda `mc mirror`. Bucket **private** bo'lib qolishi
shart — public bucket har bir tenantning hujjatini internetga ochadi.

Fayllar yo'qolsa baza ishlaydi, lekin chek fotolari 404 qaytaradi. Bu
moliyaviy hisobni buzmaydi (summalar bazada), ammo hujjat isbotini yo'qotadi.

### Redis

Backup **kerak emas**. Ichida faqat rate-limit hisoblagichlari va
refresh-token oilalari bor. Yo'qolsa:

- limitlar nolga qaytadi (bir martalik, qabul qilinadi),
- barcha foydalanuvchilar qayta login qiladi.

Bo'sh Redis bilan ko'tarilish to'g'ri harakat.

### nginx / TLS sertifikat

Konfiguratsiya repositoryda. Sertifikat:

```bash
sh deploy/certbot.sh issue api.<domain> admin@<domain>
sh deploy/check-tls.sh api.<domain>
```

---

## 5. Nima sinovdan o'tgan va nima o'tmagan

|                                                       | Holat                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| Backup → integrity → restore → qator/pul solishtiruv  | **Tekshirilgan** (staging, avtomatlashtirilgan, haftalik cron) |
| Tiklangan bazada API, finance, AI, tenant izolyatsiya | **Tekshirilgan** (staging'da qo'lda rahearsal)                 |
| Production'da to'liq almashtirish (3.3)               | **Tekshirilmagan** — production deployment hali yo'q           |
| MinIO mirror va restore                               | **Tekshirilmagan** — offsite bucket sozlanmagan                |
| WAL / point-in-time recovery                          | **Yo'q** — yoqilmagan                                          |

Uchinchi va to'rtinchi qatorlar production'ga chiqishdan oldin bir marta
bajarilishi kerak — ideal holda ish soatidan tashqarida, e'lon qilingan holda.
