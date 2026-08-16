# Backup runner: pg_dump for the database, mc for the object store, cron to
# fire it nightly. Small on purpose — it holds the company's only copy.
FROM postgres:16-alpine

RUN apk add --no-cache curl \
 && curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc \
 && chmod +x /usr/local/bin/mc

COPY deploy/backup/backup.sh deploy/backup/restore.sh /scripts/
RUN chmod +x /scripts/*.sh

# 03:00 UTC — before the nightly application jobs, so a dump is never taken
# halfway through the GPS archive move.
RUN echo '0 3 * * * /scripts/backup.sh >> /var/log/backup.log 2>&1' > /etc/crontabs/root

CMD ["sh", "-c", "crond -f -l 8 & tail -F /var/log/backup.log"]
