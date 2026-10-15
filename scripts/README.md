# Penetration test

`pentest.mjs` attacks a running MAAI from outside (about 780 requests) and prints what failed. It changes nothing on your real data when pointed at a test copy.

Run it against a **test copy only** (it saves test messages and locks sign-in for a minute at the end):

```sh
npm run build
mkdir -p /tmp/pt-data
NODE_ENV=production MAAI_PASSWORD='Pentest-Pass-2026!' MAAI_DATA_DIR=/tmp/pt-data PORT=4400 \
  TWILIO_ACCOUNT_SID=ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa TWILIO_AUTH_TOKEN=testtoken123456 \
  TWILIO_WHATSAPP_FROM=whatsapp:+14155238886 WHATSAPP_WEBHOOK_URL=https://maai.example/webhook/whatsapp \
  RENDER_EXTERNAL_URL=https://maai.example npx tsx server/index.ts &
PT_PORT=4400 PT_PASSWORD='Pentest-Pass-2026!' PT_OUT=/tmp/pentest.json node scripts/pentest.mjs
```

Restart the test server before each run (the sign-in lockout is remembered until it restarts). Never point it at your real site with your real password.
