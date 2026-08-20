# Security headers for the web bundle. Mirrors apps/web/vercel.json so the # self-hosted and Vercel
deployments behave identically. # # `connect-src 'self'` is the whole point of the single-server
shape: the app # may talk to its own origin and nowhere else, so a compromised dependency # cannot
exfiltrate to an attacker's host. add_header Strict-Transport-Security "max-age=31536000;
includeSubDomains" always; add_header X-Content-Type-Options nosniff always; add_header
X-Frame-Options DENY always; add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header Permissions-Policy "geolocation=(), camera=(), microphone=(), payment=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'
'unsafe-inline'; img-src 'self' data: blob: https://*.tile.openstreetmap.org; font-src 'self' data:;
connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
always;
