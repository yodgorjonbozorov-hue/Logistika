# Disaster recovery

Bu hujjat bazani yo'qotish holatida nima qilishni belgilaydi. Audit'gacha holat: zaxira yo'q,
PITR yo'q — **RPO = ∞, RTO = ∞** (ya'ni baza o'chsa hammasi yo'qoladi).

## Maqsadlar

| Ko'rsatkich                       | Maqsad     | Hozirgi holat (TASK-2.8 dan keyin) |
| --------------------------------- | ---------- | ---------------------------------- |
| **RPO** (qancha ma'lumot yo'qoladi) | ≤ 24 soat | 24 soat — kunlik `pg_dump`         |
| **RTO** (qancha vaqtda tiklanadi)   | ≤ 2 soat  | ~30–60 daqiqa (quyidagi qadamlar)  |

> RPO'ni soatlarga tushirish uchun WAL arxivlash (PITR) kerak. Bu keyingi bosqichda:
> hozirgi kunlik dump 5–40 texnikali firma uchun qabul qilinadigan minimum, lekin
> «bugungi barcha reyslar yo'qoldi» degani ham — buni mijozga ochiq ayting.

## Zaxira nima va qayerda

- **Nima**: butun baza (`pg_dump --clean --if-exists`, gzip).
- **Qachon**: har 24 soatda (`backup` servisi, `scripts/backup-loop.sh`).
- **Qayerda**: `backup-data` Docker volume'ida **va** MinIO'dagi `truckcontrol-backups`
  bucket'ida (`BACKUP_BUCKET`).
- **Qancha saqlanadi**: `BACKUP_RETENTION_DAYS` (default 30 kun).
- **MinIO obyektlari** (chek/hujjat fotolari) alohida: ular `minio-data` volume'ida.
  Ularni ham nusxalash kerak — quyidagi «To'liq zaxira» bo'limiga qarang.

> **Diqqat**: zaxira bazasi bilan bir xil serverda turgan nusxa — bu zaxira emas.
> Server disk yo'qotsa ikkalasi ham ketadi. Kamida haftada bir marta tashqi joyga
> (boshqa VPS, S3, yoki oddiy `rsync` bilan boshqa mashinaga) ko'chiring.

## Tiklash (RTO ~30–60 daqiqa)

```bash
cd /opt/truckcontrol

# 1. Trafikni to'xtat (nginx va backend), bazani qoldir
docker compose -f docker-compose.prod.yml stop nginx backend

# 2. Zaxirani top
docker compose -f docker-compose.prod.yml exec backup ls -lh /backups

# 3. Tikla (tasdiqlash so'raydi — baza nomini yozasiz)
docker compose -f docker-compose.prod.yml exec backup \
  /scripts/restore.sh /backups/truckcontrol-<sana>.sql.gz

# 4. Migratsiyalar holatini tekshir (zaxira eski sxemada bo'lishi mumkin)
docker compose -f docker-compose.prod.yml up -d migrate

# 5. RLS rollarini tekshir — dump `--no-owner` bilan olinadi, grant'lar qayta kerak
psql "$ADMIN_DATABASE_URL" -f scripts/create-db-roles.sql   # rollar yo'q bo'lsa

# 6. Ko'tar va tekshir
docker compose -f docker-compose.prod.yml up -d backend nginx
curl -fsS https://<domen>/api/v1/health/ready
```

Tiklashdan keyin **majburiy** tekshiruv:

- `SELECT count(*) FROM trips;` — kutilgan tartibda qatorlar bormi;
- ikki xil kompaniya foydalanuvchisi bilan kirib, bir-birining ma'lumotini ko'ra
  olmasligini tekshiring (RLS grant'lari tiklanganini isbotlaydi);
- oxirgi 24 soat ichidagi reyslar yo'qolganini logistlarga xabar qiling.

## To'liq zaxira (baza + fayllar)

```bash
# Baza — avtomatik. Fayllar (MinIO) uchun:
docker compose -f docker-compose.prod.yml exec minio \
  mc mirror --overwrite /data /backups/minio
```

Fayllar yo'qolsa reyslar va xarajatlar qoladi, lekin chek fotolari ketadi — buxgalteriya
uchun bu jiddiy. Fayl zaxirasini ham retention bilan boshqaring.

## Oylik mashq (majburiy)

Tiklanmagan zaxira — umid, zaxira emas. Har oy, ~30 daqiqa:

1. Oxirgi dump'ni **alohida** bazaga tikla:
   ```bash
   RESTORE_ASSUME_YES=true ./scripts/restore.sh <fayl> truckcontrol_restore_test
   ```
2. Qator sonlarini solishtir (`trips`, `expenses`, `incomes`, `users`).
3. Sarflangan vaqtni yozib bor — bu sizning haqiqiy RTO'ngiz.
4. Natijani jamoaga yoz: sana, fayl, davomiyligi, muammolar.

Mashq muvaffaqiyatsiz bo'lsa — bu **incident**, keyingi relizdan muhimroq.

## Nima ishlamayapti (halol ro'yxat)

- **PITR yo'q**: WAL arxivlash sozlanmagan, ya'ni oxirgi dump'dan keyingi ma'lumot
  qaytarilmaydi.
- **Avtomatik tashqi replikatsiya yo'q**: dump o'sha serverdagi volume'da va MinIO'da.
- **Zaxira monitoringi**: `backup-loop.sh` xatoni `stderr`ga yozadi va Sentry'ga tushmaydi —
  hozircha log ko'rish kerak. Alert qo'shish `docs/RUNBOOK.md`da.
