# Security headers for API (JSON) responses on the single-server edge. # This origin also serves
HTML, so the API's CSP is set per-location rather # than at server level — `default-src 'none'`
would break the app if it # leaked onto the document. add_header Strict-Transport-Security
"max-age=31536000; includeSubDomains" always; add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always; add_header Referrer-Policy no-referrer always; add_header
Content-Security-Policy "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action
'none'" always; add_header Permissions-Policy "geolocation=(), camera=(), microphone=(), payment=(),
usb=()" always; add_header Cross-Origin-Resource-Policy same-origin always; add_header
Cross-Origin-Opener-Policy same-origin always;
