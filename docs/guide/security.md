# Security notes

- **Encryption at rest**: each file is encrypted with AES-256-GCM in 64 KiB segments. Every file has its own random key, wrapped with a key derived (HKDF) from the master key.
- **Plaintext on disk during upload**: the uploaded file sits unencrypted in the tus temp folder (same volume, `/data/tmp`) until encryption finishes, then it is deleted. This is an accepted trade-off: encryption runs once the upload is complete, so interrupted uploads can resume.
- **No antivirus**: files are not scanned. A future option is a ClamAV sidecar that scans the temp file before encryption through a hook; it is not implemented.
- **Logs**: IP addresses appear only as HMAC hashes, never in clear. Download tokens are not logged. Container logs rotate (3 files of 10 MB per service). Download and audit logs are kept 90 days.
- **Keep `WEB_BIND` on `127.0.0.1`**. If you publish the web port to the network, clients can spoof `X-Forwarded-For` and `CF-Connecting-IP` and defeat rate limits and IP hashing.
- **HSTS**: enable it in Cloudflare, since TLS ends there.
- **SMTP test**: an admin can make the server connect to any host and port through the SMTP test. It is admin-only and rate limited (10 per hour).
- Passwords use argon2id, sessions are server-side with hashed tokens, CSRF is checked on every unsafe request, and all input is validated with Zod.

To report a vulnerability see [SECURITY.md](https://github.com/ivanerricis/easysend/blob/main/SECURITY.md).
