# TruckAI — Production Checklist

Birinchi haqiqiy foydalanuvchi kirishidan oldin. Har band uchun **ishga
tushiriladigan buyruq** bor: "shunday deb o'ylayman" javob emas.

Belgilar: `[ ]` bajarilmagan · `[x]` bajarilgan va tekshirilgan ·
`[–]` bu deployment uchun tegishli emas (sababi bilan).

---

## Infratuzilma

- [ ] **DNS** — `app.<domain>` va `api.<domain>` serverga qaratilgan
      `dig +short app.<domain> api.<domain>`
- [ ] **TLS** — haqiqiy sertifikat, TLS 1.2/1.3, HTTP→HTTPS
      `sh deploy/check-tls.sh api.<domain>` → _TLS configuration is sound_
- [ ] **Sertifikat yangilanishi** avtomatik
      `systemctl list-timers truckai-certbot.timer`
- [ ] **Sertifikat muddati kuzatiladi** (cron, 21 kunlik ogohlantirish)
- [ ] **nginx** konfiguratsiyasi repositorydan, `server_name` haqiqiy domen
      `nginx -t`
- [ ] **PostgreSQL 16+**
      `psql "$DATABASE_URL" -tAc 'show server_version'`
- [ ] **Redis** ishlaydi va (loopback bo'lmasa) parol bilan
- [ ] **MinIO/S3 bucket private**
      `mc anonymous get <alias>/truckai` → `none`

## Konfiguratsiya

- [ ] `.env.production` `chmod 600`, repositoryda emas
- [ ] Placeholder qolmagan
      `sh deploy/check-production-env.sh /etc/truckai/.env.production`
- [ ] `NODE_ENV=production`
- [ ] `JWT_ACCESS_SECRET` ≠ `JWT_REFRESH_SECRET`, ikkalasi ham 32+ belgi
- [ ] `WEB_URL` — https, haqiqiy domen
- [ ] `TRUST_PROXY` aniq yozilgan (nginx ortida `1`)
- [ ] `MINIO_USE_SSL=true` (endpoint loopback bo'lmasa)
- [ ] `VITE_API_URL` haqiqiy API domenini ko'rsatadi
- [ ] `vercel.json` CSP `connect-src` haqiqiy API domenini ko'rsatadi

## Ma'lumotlar bazasi

- [ ] Ilova roli **SUPERUSER emas** va `CREATEDB` yo'q
      `psql "$DATABASE_URL" -tAc "select rolsuper, rolcreatedb from pg_roles where rolname=current_user"` → `f | f`
- [ ] Ilova roli DDL qila olmaydi
      `psql "$DATABASE_URL" -c "create table x(i int);"` → _permission denied_
- [ ] Migratsiyalar to'liq qo'llangan
      `DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate status` → _up to date_
- [ ] Drift yo'q — `prisma migrate diff` bo'sh migratsiya qaytaradi
- [ ] `prisma db push` **ishlatilmagan**

## Backup va tiklanish

- [ ] Kunlik backup cron'da
- [ ] `BACKUP_PASSPHRASE` **boshqa joyda** saqlanadi (backup serverida emas)
- [ ] `BACKUP_S3_TARGET` sozlangan — offsite nusxa bor
- [ ] Backup shifrlangan
      `file <eng-yangi>.dump.gpg` → _PGP symmetric key encrypted data_
- [ ] **Restore haqiqatan sinab ko'rilgan**
      `sh deploy/backup-verify.sh` → _RESTORE VERIFIED_
- [ ] Haftalik restore rahearsal cron'da
- [ ] MinIO fayllari alohida offsite'ga ko'chiriladi
- [ ] RPO/RTO yozilgan va biznes bilan kelishilgan — `docs/DISASTER-RECOVERY.md`

## Xavfsizlik

- [ ] Repositoryda sir yo'q
      `git log --all --diff-filter=A --name-only --pretty=format: | sort -u | grep -E '\.env$|\.pem$|\.key$|\.dump$'` → bo'sh
- [ ] `.gitignore` `.env.*`, `*.pem`, `*.key`, `*.dump` ni bloklaydi
- [ ] Xavfsizlik sarlavhalari (HSTS, CSP, XFO, Referrer-Policy) — **bir marta**,
      ikki xil qiymatda emas
      `curl -sI https://api.<domain>/ | grep -ci x-frame-options` → `1`
- [ ] `server_tokens off` — versiya oshkor qilinmaydi
- [ ] JSON javoblar gzip qilinmaydi (BREACH)
- [ ] Rate limiting ishlaydi va 429 `Retry-After` bilan qaytadi
- [ ] Kritik/yuqori darajali bog'liqlik zaifligi yo'q, yoki har biri uchun
      runtime'ga yetib bormasligi hujjatlashtirilgan
      `pnpm audit --prod`
- [ ] Source map production bundle'ida yo'q
- [ ] Swagger/debug endpoint ochiq emas
- [ ] AI API kaliti bundle'da yo'q
      `grep -rlE "sk-ant|ANTHROPIC|AI_API_KEY" apps/web/dist/` → bo'sh

## Ilova

- [ ] `/health/live` va `/health/ready` javob beradi va **farq qiladi**
- [ ] `/health` internetdan yopiq (faqat ichki tarmoq)
- [ ] Strukturali loglar yozilyapti (`requestId`, `userId`, `companyId`)
- [ ] Loglarda sir yo'q
      `grep -cE "eyJ|password=|sk-" /var/log/truckai/api.log` → `0`
- [ ] `debug`/`verbose` loglar o'chiq
- [ ] Log rotatsiyasi sozlangan
- [ ] Kutilmagan xato → process chiqadi va qayta ko'tariladi (`Restart=on-failure`)

## Testlar (deploy artefaktida)

- [ ] `pnpm lint` toza
- [ ] `pnpm typecheck` toza
- [ ] `pnpm format:check` toza
- [ ] `pnpm test` — barcha unit testlar
- [ ] `pnpm --filter backend test:e2e` — haqiqiy PostgreSQL/Redis/MinIO
- [ ] Tenant izolyatsiya testlari o'tadi
- [ ] RBAC matritsasi va **authz coverage** testlari o'tadi
- [ ] `pnpm build` — VITE_API_URL bilan
- [ ] Flutter: `flutter analyze && flutter test`

## Deployment tekshiruvi

- [ ] `bash deploy/smoke-test.sh` → **0 fail**
- [ ] Yuklama testi 5xx bermaydi
      `node deploy/load-test.mjs --url … --duration 10 --concurrency 20`
- [ ] p95 kutilgan chegarada (staging'da o'lchangan: 25–41 ms @ 20 parallel)
- [ ] Xotira barqaror (yuklamadan keyin RSS o'sishda davom etmaydi)
- [ ] Baza ulanishlari pool chegarasida qolmoqda

## Kuzatuv

- [ ] `/health/ready` tashqi monitoringga ulangan
- [ ] Disk bo'sh joyi kuzatiladi (< 15% → ogohlantirish)
- [ ] 5xx tezligi kuzatiladi
- [ ] 401/429 cho'qqilari kuzatiladi
- [ ] `REFRESH_REUSE_DETECTED` audit hodisasi ogohlantiradi
- [ ] Backup muvaffaqiyatsizligi ogohlantiradi
- [ ] Sertifikat muddati ogohlantiradi

## Hujjatlar va tayyorlik

- [ ] `docs/ROLLBACK.md` o'qilgan — kim, qachon, qanday
- [ ] `docs/DISASTER-RECOVERY.md` o'qilgan, RPO/RTO kelishilgan
- [ ] Birinchi administrator paroli parol menejerida
- [ ] Backup parol menejerida
- [ ] Navbatchi bor va unda serverga kirish huquqi bor

---

## Yakuniy holat

Barcha `[ ]` yopilgandan keyin:

**🟢 PRODUCTION READY**

Bittasi ham ochiq bo'lsa — ochiq bandni sababi bilan yozing va holat
**🟡 READY AFTER FIXES** bo'lib qoladi. Tekshirilmagan bandni bajarilgan deb
belgilash — bu ro'yxatning yagona haqiqiy nosozlik usuli.
