# TruckAI — Deployment

Noldan production'ga. Arxitektura — [PRODUCTION.md](PRODUCTION.md).

Har bir qadamda tekshiruv bor. **Tekshiruvni o'tkazib yubormang** — keyingi
qadam oldingisi ishlaganini taxmin qiladi.

---

## 0. Talablar

|                    | Versiya | Eslatma                          |
| ------------------ | ------- | -------------------------------- |
| Node.js            | 22      |                                  |
| pnpm               | 9.15    |                                  |
| PostgreSQL         | **16+** | Pastroq versiya qabul qilinmaydi |
| Redis              | 7+      |                                  |
| MinIO yoki S3      | —       | Private bucket                   |
| nginx              | 1.24+   |                                  |
| certbot            | —       | Let's Encrypt uchun              |
| gpg, psql, pg_dump | —       | Backup uchun                     |

DNS: `app.<domain>` va `api.<domain>` A yozuvlari **serverga qaratilgan
bo'lishi kerak** — certbot HTTP-01 challenge shu orqali ishlaydi. Bu operator
ishi va skript uni bajara olmaydi.

---

## 1. Baza va rollar

```bash
sudo -u postgres createdb truckai

# Ikki rol: migrator (DDL) va app (faqat ma'lumot). §3 PRODUCTION.md
sudo -u postgres psql -d truckai \
  -v app_password="'$(openssl rand -base64 24)'" \
  -v migrator_password="'$(openssl rand -base64 24)'" \
  -f deploy/postgres-roles.sql
```

Parollarni chiqishdan nusxa oling — ular `.env.production` ga kerak va boshqa
hech qayerda saqlanmaydi.

**Tekshiruv** (skriptning o'zi chiqaradi):

```
 rolname          | rolsuper | rolcreatedb | rolcreaterole
 truckai_app      | f        | f           | f
 truckai_migrator | f        | f           | f
 app_can_create_in_schema | app_can_create_schema
 f                        | f
```

---

## 2. Environment

```bash
sudo mkdir -p /etc/truckai
sudo cp .env.production.example /etc/truckai/.env.production
sudo chmod 600 /etc/truckai/.env.production
sudo $EDITOR /etc/truckai/.env.production
```

Sirlarni generatsiya qiling (har biri alohida):

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET  ← boshqasi bo'lishi SHART
openssl rand -base64 24   # MINIO_ROOT_PASSWORD
openssl rand -base64 24   # BACKUP_PASSPHRASE
```

> `BACKUP_PASSPHRASE` ni **boshqa joyda** saqlang — parol menejerida, backup
> serverida emas. Yo'qolsa hech bir backup ochilmaydi.

**Tekshiruv:**

```bash
sh deploy/check-production-env.sh /etc/truckai/.env.production
# → "Environment file looks deployable."
```

---

## 3. Migratsiyalar

Migratsiyalar **faqat migrator roli bilan** va faqat migration job orqali
qo'llaniladi. Ilova runtime'i schema'ni o'zgartirmaydi.

```bash
cd apps/backend
DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy
```

`prisma db push` **hech qachon** ishlatilmaydi: u migration tarixini
chetlab o'tadi va keyingi har bir deployni drift bilan yiqitadi.

**Tekshiruv:**

```bash
DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate status
# → "Database schema is up to date!"
```

---

## 4. Birinchi administrator

```bash
cd apps/backend
DATABASE_URL="$MIGRATION_DATABASE_URL" \
SUPERADMIN_EMAIL=admin@<domain> \
SUPERADMIN_PASSWORD="$(openssl rand -base64 24)" \
SUPERADMIN_NAME="Platform Administrator" \
npx prisma db seed
```

Seed idempotent va zaif/placeholder parolni rad etadi. Generatsiya qilingan
parolni parol menejeriga yozing — u boshqa hech qachon chiqarilmaydi.

---

## 5. Object storage

```bash
mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb local/truckai
mc anonymous set none local/truckai      # PRIVATE — majburiy
```

**Tekshiruv:**

```bash
mc anonymous get local/truckai
# → "Access permission for `local/truckai` is `none`"
```

---

## 6. API

```bash
pnpm install --frozen-lockfile
pnpm --filter shared build
pnpm --filter backend build
```

systemd unit:

```ini
# /etc/systemd/system/truckai-api.service
[Unit]
Description=TruckAI API
After=network-online.target postgresql.service redis.service

[Service]
Type=simple
User=truckai
WorkingDirectory=/opt/truckai/current/apps/backend
EnvironmentFile=/etc/truckai/.env.production
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5
# Ilova stdout'ga yozadi; rotatsiya — MONITORING.md §2
StandardOutput=append:/var/log/truckai/api.log
StandardError=append:/var/log/truckai/api.log

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now truckai-api
```

**Tekshiruv:**

```bash
curl -sS http://127.0.0.1:3000/api/v1/health/ready | jq .data.ready   # → true
```

Ilova ko'tarilmasa — birinchi navbatda env xatosini o'qing: u yagona qatorda
barcha muammolarni sanaydi.

---

## 7. nginx va TLS

```bash
sudo cp deploy/nginx.conf /etc/nginx/nginx.conf
sudo $EDITOR /etc/nginx/nginx.conf     # server_name → api.<domain>
sudo mkdir -p /var/www/certbot
sudo nginx -t && sudo systemctl reload nginx

sh deploy/certbot.sh issue api.<domain> admin@<domain>
sudo sh deploy/certbot.sh install-timer          # avtomatik yangilanish
```

`certbot.sh issue` haqiqiy sertifikat so'rashdan **oldin** challenge yo'lini
tekshiradi: muvaffaqiyatsiz haqiqiy urinish Let's Encrypt limitiga (haftasiga
5 ta) hisoblanadi, mahalliy tekshiruv esa bepul.

**Tekshiruv:**

```bash
sh deploy/check-tls.sh api.<domain>
# → "TLS configuration is sound."
```

---

## 8. Web

Vercel:

1. Repository'ni ulang, root — `apps/web`.
2. Environment: `VITE_API_URL=https://api.<domain>/api/v1`.
3. Domen: `app.<domain>`.

`apps/web/vercel.json` SPA rewrite, cache va xavfsizlik sarlavhalarini
(CSP kiritilgan) o'zi olib yuradi.

> **`vercel.json` dagi CSP'ni tekshiring.** `connect-src` haqiqiy API
> domeningizni ko'rsatishi kerak; noto'g'ri bo'lsa brauzer har API
> chaqiruvini bloklaydi va sahifa bo'sh kartalar bilan chiqadi.

`VITE_API_URL` siz production build **ataylab yiqiladi** — bu regressiya emas.

### Vercel: ikkita sozlama, ikkalasi ham majburiy

Web Vercel'da, API boshqa domenda bo'lsa — ya'ni **cross-site** — quyidagi ikki
narsa to'g'ri bo'lmasa ilova ishlamaydi va buni build ham, test ham aytmaydi:

**1. CSP `connect-src` API originini ruxsat etishi shart.**

`vercel.json` dagi siyosat brauzerda majburlanadi. `VITE_API_URL` u ruxsat
etmagan originni ko'rsatsa, sahifa ochiladi, tugmalar chiziladi va **har bir
so'rov brauzerda "Refused to connect" bilan o'ladi** — login hech narsa
qilmaydi, dashboard bo'sh kartalar ko'rsatadi. Development'da bu hech qachon
yuz bermaydi, chunki dev-server CSP yubormaydi.

```json
"connect-src 'self' https://api.<domen>"
```

Vercel'da build qilinayotganda (`VERCEL=1`) mos kelmasa build **yiqiladi** va
qaysi qatorni qo'shish kerakligini aytadi.

**2. `AUTH_COOKIE_SAMESITE=none` bo'lishi shart.**

Refresh token httpOnly cookie'da yashaydi va web klient uni **faqat** cookie
orqali yuboradi. Cross-site deploymentda `SameSite=Strict` cookie'ni brauzer
**umuman saqlamaydi** (haqiqiy brauzerda tekshirilgan). Natija: login ishlagandek
ko'rinadi, keyin birinchi sahifa yangilanishida yoki 15 daqiqadan so'ng
foydalanuvchi login sahifasiga uchadi.

`none` ochadigan CSRF yo'li auth route'laridagi `Origin` tekshiruvi bilan
yopilgan — boshqa saytdan yuborilgan refresh/logout 403 oladi, native klient
(Origin yubormaydi) esa ishlashda davom etadi.

> Bu ikki muammoning ikkalasi ham **bitta domenda** (`--mode single-server`)
> umuman mavjud emas: `connect-src 'self'` yetarli va `SameSite=Strict` ishlaydi.
> Shuning uchun standart tanlov shu.

---

## 9. Backup

```bash
sudo mkdir -p /var/backups/truckai && sudo chmod 700 /var/backups/truckai
```

`crontab -e`:

```cron
17 2 * * *  BACKUP_PASSPHRASE=... /bin/sh /opt/truckai/deploy/backup.sh >> /var/log/truckai-backup.log 2>&1
40 3 * * 0  BACKUP_PASSPHRASE=... SOURCE_URL=... /bin/sh /opt/truckai/deploy/backup-verify.sh >> /var/log/truckai-restore-check.log 2>&1
11 6 * * *  /bin/sh /opt/truckai/deploy/check-tls.sh api.<domain>
```

**Tekshiruv — birinchi backup'ni qo'lda oling va haqiqatan tiklang:**

```bash
BACKUP_PASSPHRASE=… sh deploy/backup.sh
BACKUP_PASSPHRASE=… SOURCE_URL="$MIGRATION_DATABASE_URL" sh deploy/backup-verify.sh
# → "RESTORE VERIFIED — this backup is recoverable."
```

Bu qadamni **birinchi deployda** bajaring. Backup'ni birinchi marta avariya
paytida sinash — eng qimmat usul.

---

## 10. Yakuniy tekshiruv

```bash
BASE_URL=https://api.<domain> \
WEB_BASE_URL=https://app.<domain> \
SUPERADMIN_EMAIL=admin@<domain> SUPERADMIN_PASSWORD='…' \
BACKUP_DIR=/var/backups/truckai \
MIGRATION_DATABASE_URL='…' \
bash deploy/smoke-test.sh
```

**0 fail bo'lishi shart.** Chiqish kodi — muvaffaqiyatsiz tekshiruvlar soni,
ya'ni CI to'g'ridan-to'g'ri unga tayanishi mumkin.

Keyin: [PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md).

---

## 11. Keyingi deploylar

```bash
git pull
pnpm install --frozen-lockfile
pnpm --filter shared build && pnpm --filter backend build

# Migratsiya bo'lsa — buzuvchi bo'lsa OLDIN backup oling
BACKUP_PASSPHRASE=… sh deploy/backup.sh
DATABASE_URL="$MIGRATION_DATABASE_URL" npx --prefix apps/backend prisma migrate deploy

sudo systemctl restart truckai-api
curl -sS https://api.<domain>/api/v1/health/ready
bash deploy/smoke-test.sh
```

Muammo bo'lsa: [ROLLBACK.md](ROLLBACK.md).
