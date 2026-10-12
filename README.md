# MAAI: Musaed Abdulrahman AI

A bilingual (Arabic / English) personal assistant, built from the Musaed design
canvas. It plans your day, books meetings, sets reminders and drafts replies,
and **it never acts on its own**: every booking or reminder appears as a card
you approve first, and replies open in WhatsApp for you to send.

## Run it (Windows, Mac or Linux)

You need [Node.js](https://nodejs.org) 20 or newer.

```
npm install
npm run dev
```

Open **http://localhost:5173**. The admin portal is at
**http://localhost:5173/#/admin**.

### Use it on your phone

```
npm run phone
```

This runs MAAI as usual and also serves it to phones on the same Wi-Fi. The
terminal shows a QR code, an address like `https://192.168.1.20:5174` and a
6-digit PIN.

1. Scan the QR code with the phone camera (or type the address in Safari).
2. Safari warns that the connection is not private. That is expected for a
   server at home: tap **Show Details** → **visit this website** → **Visit Website**.
3. Enter the PIN from the terminal.
4. To install it like an app: Share button → **Add to Home Screen**.

The first time, Windows asks whether Node.js may use the network: tick
**Private networks** and click **Allow**. Phones need the PIN once; the
computer itself never does. Set your own PIN with `MAAI_PIN=` in `.env`.

### Notifications

Settings → **Notifications** → **Turn on notifications**. MAAI then alerts you
at reminder time, when it's time to leave for an appointment with travel time,
and (if you switch them on) before each event or prayer, even with the app
closed. Reminders can be tied to a prayer ("15 minutes after Maghrib").

- **On the computer:** works in Chrome or Edge at `http://localhost:5173`.
- **On iPhone** (iOS 16.4 or newer), with `npm run phone` running:
  1. Add MAAI to the Home Screen and open it from the icon.
  2. Settings → Notifications shows **Download certificate**: tap it and allow.
  3. iPhone Settings → General → VPN & Device Management → MAAI → **Install**.
  4. iPhone Settings → General → About → Certificate Trust Settings → turn on **MAAI**.
  5. Back in MAAI: **Turn on notifications**.

Alerts come from your computer, so it has to be on with MAAI running. While
MAAI is open, alerts also appear as a banner at the top.

### Turn on the AI

Without a key MAAI runs in **demo mode** with simple canned replies, so you can
try every screen. For real answers:

1. Get an API key at <https://console.anthropic.com> → **API Keys**.
2. In the project folder, copy `.env.example` to a new file named `.env`
   (Command Prompt: `copy .env.example .env`).
3. Open `.env` in Notepad and paste your key after `ANTHROPIC_API_KEY=`.
4. Stop the app (Ctrl+C) and run `npm run dev` again.

The terminal says `Claude connected` when the key is picked up. Keep `.env`
private: it is excluded from Git so it never gets uploaded.

## Put it online (Render)

Online, MAAI runs all the time at a real `https://` address: it works away from
home, notifications arrive without your computer on, and iPhone needs no
certificate steps. Everything is behind a password.

1. Sign up at <https://render.com> with your GitHub account and let Render see
   the `musaedapp` repository.
2. Dashboard → **New** → **Blueprint** → pick `musaedapp` → **Connect**.
   Render reads `render.yaml` and sets everything up.
3. It asks for two values:
   - `ANTHROPIC_API_KEY`: your Claude key.
   - `MAAI_PASSWORD`: a password of at least 8 characters. You sign in with it.
4. **Apply**. The first build takes a few minutes. Your address appears at the
   top, like `https://maai-xxxx.onrender.com`.

Cost: Render's Starter plan (about $7/month) plus about $0.25/month for the
1 GB disk that keeps your data. Claude usage is billed separately by Anthropic.
Every push to `main` updates the live site automatically.

On iPhone: open the address in Safari, sign in, Share → **Add to Home Screen**,
open MAAI from the icon, then Settings → **Turn on notifications**.

Your data online starts fresh; it is separate from the copy on your computer.

## What's in it

| Screen | What it does |
|---|---|
| **Today** | Gregorian and Hijri date, an AI morning briefing you can listen to, the day's schedule with the five prayer times marked as protected, "leave by" hints, a free-time suggestion, reminders. |
| **Assistant** | Chat by typing or by voice (Chrome / Edge). Ask it to book a meeting or set a reminder; it replies with an approval card. Nothing happens until you tap Approve. Meeting times that clash with a prayer are rejected. |
| **Inbox** | Paste a message from WhatsApp or email; MAAI drafts a reply in the tone you pick (short, friendly, formal, Arabic) using your real calendar, then opens it in WhatsApp for you to send. |
| **Settings** | Language (English / العربية, right-to-left), light / dark / system, and accessibility: simple mode, captions, read replies aloud, slower speech, larger text, high contrast, reduced motion. |
| **Admin** (`#/admin`) | Live counts, approval rate, Claude token usage, switches to pause each agent, integration status and the audit log of every proposal and approval. |

## How it fits together

```
server/      Express API (one process serves the app and /api)
  ai.ts      Claude: chat with approval-card tools, reply drafts, briefing, demo mode
  routes.ts  REST endpoints
  store.ts   Data, saved to data/store.json (delete it to start fresh)
  auth.ts    Sign-in: PIN on the home Wi-Fi, password online
  phone.ts   HTTPS certificate, PIN and QR code for phone access
  notify.ts  Alert timing and Web Push (reminders, time to leave, prayers)
shared/      Types and prayer times (Umm al-Qura), used by both sides
src/         React app
  screens/   Today, Assistant, Inbox, Settings
  admin/     Admin portal
```

The AI uses Claude (`claude-opus-5-5`) through the official Anthropic SDK. Its
only tools are `propose_meeting` and `propose_reminder`, and both just create a
pending card; the server books or saves only when you approve. Requests use the
API's server-side fallback, so if a safety check declines a request it is
retried on a suitable model instead of failing.

Other settings in `.env`: `PORT`, `MAAI_DATA_DIR` (where data is kept), and `MAAI_LATITUDE` / `MAAI_LONGITUDE` /
`MAAI_TIMEZONE` for prayer times (default Riyadh).

| Command | Does |
|---|---|
| `npm run dev` | Runs the app with live reload |
| `npm run phone` | Same, plus HTTPS + PIN access for phones on your Wi-Fi |
| `npm start` | Builds and runs the online version (needs `MAAI_PASSWORD`) |
| `npm run serve` | Runs an already-built online version (what Render uses) |
| `npm test` | Runs the tests |
| `npm run typecheck` | Checks the TypeScript |

## Not built yet

Connecting real Google / Outlook calendars and email, accounts for more than
one person, and a native iPhone app. The old StockPlay
project is kept in `archive/stockplay`.
