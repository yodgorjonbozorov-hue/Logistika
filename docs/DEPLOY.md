# Production'ga o'rnatish

> Bitta server, Docker Compose. 5–40 texnikali firma uchun bu yetadi va
> boshqarishga bitta odam kifoya qiladi.

## 1. Server

Minimal: 2 vCPU, 4 GB RAM, 60 GB SSD, Ubuntu 22.04+. Docker va Compose plugin
o'rnatilgan bo'lishi kerak. Domen A-yozuvi shu serverga qaratilgan bo'lsin.

## 2. `.env`

```bash
git clone <repo> truckcontrol && cd truckcontrol
cp .env.example .env
```

Production uchun majburiy:

| O'zgaruvchi                                | Izoh                                               |
| ------------------------------------------ | -------------------------------------------------- |
| `PANEL_DOMAIN`                             | `panel.firma.uz` — sertifikat shu nomga olinadi    |
| `POSTGRES_USER` / `POSTGRES_PASSWORD`      | Kuchli parol, `.env` dan tashqarida saqlanmasin    |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Har biri kamida 32 tasodifiy belgi                 |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`  | Fayl saqlash kirish ma'lumotlari                   |
| `BACKUP_DIR`                               | Zaxira papkasi — **boshqa diskda yoki tashqarida** |

Sirlarni shunday yarating:

```bash
openssl rand -base64 48
```

`ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `WHISPER_API_URL`, `SMS_PROVIDER_*`
ixtiyoriy: bo'lmasa tegishli funksiya o'chadi, tizim qolgan hammasi bilan
ishlayveradi (TZ §8.12, 5-qoida).

## 3. Sertifikat (birinchi marta)

nginx sertifikatsiz ko'tarilmaydi, sertifikat esa ACME uchun ochiq 80-portni
talab qiladi. Shuning uchun birinchi sertifikat alohida olinadi:

```bash
mkdir -p deploy/letsencrypt deploy/certbot-www
docker run --rm -p 80:80 \
  -v "$PWD/deploy/letsencrypt:/etc/letsencrypt" \
  -v "$PWD/deploy/certbot-www:/var/www/certbot" \
  certbot/certbot certonly --standalone \
  -d "$PANEL_DOMAIN" --agree-tos -m admin@firma.uz --no-eff-email
```

Keyin yangilanish avtomatik: `certbot` konteyneri kuniga ikki marta urinadi va
90 kunlik muddat tugashidan ancha oldin yangilaydi.

## 4. Ishga tushirish

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Backend ko'tarilishida `prisma migrate deploy` avtomatik bajariladi — faqat
commit qilingan migratsiyalar qo'llaniladi, yangisi generatsiya qilinmaydi.

Tekshirish:

```bash
curl -sf https://$PANEL_DOMAIN/api/v1/health && echo OK
docker compose -f docker-compose.prod.yml ps
```

Faqat `nginx` port ochadi. Postgres, Redis va MinIO ichki tarmoqda qoladi —
firewall qoidasi unutilsa ham ular internetdan ko'rinmaydi.

## 5. Birinchi firma

Firma va uning birinchi OWNER foydalanuvchisi `POST /api/v1/admin/companies`
orqali yaratiladi (superadmin token bilan) — qadamlar `docs/PILOT.md` §3 da.

Namunaviy (seed) firma — bu ishlab chiqish va ko'rsatish vositasi. Kerak bo'lsa
uni repo nusxasidan ishga tushiring, production konteyneridan emas:

```bash
DATABASE_URL=<production url> pnpm --filter backend seed
```

Seed alohida tenant yaratadi va uni pilot firma bilan aralashtirmaydi.

## 6. Diskni shifrlash (TZ §9)

TZ §9: «Fotolar va hujjatlar shifrlangan saqlash». Bitta serverli o'rnatishda
eng ishonchli va eng sodda yo'l — MinIO va PostgreSQL ma'lumotlari turgan
diskni **LUKS** bilan shifrlash. Bu kalit boshqaruvini talab qilmaydi va disk
o'g'irlansa yoki almashtirilsa ma'lumot o'qilmaydi.

Serverni tayyorlashda (ma'lumot yozilishidan **oldin**):

```bash
cryptsetup luksFormat /dev/sdb
cryptsetup open /dev/sdb truckcontrol
mkfs.ext4 /dev/mapper/truckcontrol
mount /dev/mapper/truckcontrol /srv/truckcontrol
# docker volume'larini shu yerga ko'chiring yoki compose'ni shu yo'lga qarating
```

Zaxira nusxa ham shu qoidaga bo'ysunadi: `BACKUP_DIR` shifrlangan diskda
bo'lsin, tashqariga ko'chirilganda esa `age` yoki `gpg` bilan shifrlang.

> Bulutdagi obyekt saqlash (S3/MinIO KES) bilan SSE-S3 keyingi bosqich; pilot
> uchun disk shifrlash yetarli va ortiqcha kalit infratuzilmasi talab qilmaydi.

## 7. Zaxira nusxa (TZ §9)

`backup` konteyneri har kuni 03:00 UTC da ishlaydi va `BACKUP_DIR` ichiga
`<sana>/` papkasini yozadi: `database.dump` (pg_dump custom format) va
`files/` (MinIO mirror). `BACKUP_RETENTION_DAYS` (default 14) dan eski
papkalar o'chiriladi.

Skript har tunda `pg_restore --list` bilan dump'ni o'qib ko'radi: buzilgan yoki
yarim yozilgan fayl o'sha kuniyoq bilinadi, tiklash kerak bo'lgan kuni emas.

**Zaxirani serverdan tashqariga ko'chiring.** Bir diskdagi nusxa disk
yo'qolganda nusxa emas:

```bash
# Masalan, boshqa serverga har kuni
rsync -az --delete "$BACKUP_DIR/" backup@boshqa-server:/srv/truckcontrol-backups/
```

## 8. Tiklashni tekshirish

Zaxira ishlayotganini bilishning yagona yo'li — uni tiklab ko'rish. Buni
**oyiga bir marta**, alohida (bo'sh) bazada bajaring:

```bash
RESTORE_CONFIRM=yes docker compose -f docker-compose.prod.yml \
  run --rm -e POSTGRES_DB=truckcontrol_restore_test backup \
  /scripts/restore.sh /backups/2026-08-16_0300
```

Keyin qo'lda tekshiring: bitta reysning P&L raqami va bitta chek fotosi
ochiladimi. Ikkalasi ham ochilsa — zaxira haqiqatan ishlaydi.

`restore.sh` `RESTORE_CONFIRM=yes` bo'lmasa ishlamaydi: u ko'rsatilgan
bazaning sxemasini o'chirib qayta yozadi.

## 9. Yangilash

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migratsiya avtomatik qo'llaniladi. Jiddiy o'zgarishdan oldin qo'lda zaxira
oling:

```bash
docker compose -f docker-compose.prod.yml exec backup /scripts/backup.sh
```

## 10. Loglar va monitoring

```bash
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f backup
```

Kunlik minimal nazorat: `backup` logida oxirgi tunning `done` satri bor-yo'qligi
va `https://$PANEL_DOMAIN/api/v1/health` javob berayotgani.
