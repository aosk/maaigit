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

### Send email from your Gmail

Ask MAAI *"Email ahmed@example.com that I'll be 15 minutes late"*: it shows an
editable email card and sends only when you tap **Send**. Replies in the Inbox
can go by email too. Mail goes out from your own Gmail and shows in **Sent**.

1. Turn on 2-Step Verification: myaccount.google.com → Security.
2. Create an App Password at <https://myaccount.google.com/apppasswords> (name it MAAI).
3. Add `GMAIL_USER` (your address) and `GMAIL_APP_PASSWORD` (the 16 letters) to
   `.env`, or on Render under **Environment**. Settings in the app shows
   "Sending email as …" once it is connected.

Without them, the card opens your mail app with the email filled in instead.
Delete the App Password in your Google account at any time to cut MAAI off.

The same App Password lets MAAI **read** your inbox: Inbox → **Email** shows a
summary of the last two days of your Primary inbox, sorted into *Needs your
decision*, *Needs a reply*, *For your information* and *Can skip*, each with a
suggestion. Tap a decision and the assistant reads that email and drafts your
reply for you to approve. Reading is read-only (nothing is marked read, moved
or deleted), emails are kept in memory only, and their text is sent to Claude to
summarise. You can also ask the assistant about an email ("what did Sara want?").
Set `MAAI_DEMO_INBOX=1` to try the screen with sample emails before connecting Gmail.

### Keep your calendars matching

MAAI shows one calendar made from three places, each meeting once:

| Source | How it gets to MAAI | Direction |
|---|---|---|
| **Google (Gmail) Calendar** | Its private address, `GOOGLE_CALENDAR_ICS_URL` | Google → MAAI |
| **iPhone calendar** | If the phone uses your Google account, it's the same calendar as above. For an iCloud calendar, share it publicly (below) and add that link too | Phone → MAAI |
| **Meetings MAAI books** | A private link MAAI publishes (Settings → *MAAI calendar on your phone*) that the phone and Google subscribe to | MAAI → phone and Google |

1. **Google:** Google Calendar on a computer → gear → **Settings** → your calendar under
   *Settings for my calendars* → **Integrate calendar** → copy **Secret address in iCal format**.
2. **iPhone:** easiest is to make the phone use Google: iPhone Settings → Calendar → Accounts →
   Add Account → Google, and switch Calendars on. Then the phone, Google and MAAI agree. For an
   iCloud calendar instead: Calendar app → Calendars → (i) next to it → **Public Calendar** → copy
   the link (it starts `webcal://`).
3. Put every address in `GOOGLE_CALENDAR_ICS_URL` (`.env`, or Render → **Environment**), separated by
   spaces. Settings → **Connections** then lists each calendar with its event count, a ✗ if one
   can't be read, and how many repeated meetings were shown once.
4. **MAAI → phone:** Settings → **Add to iPhone Calendar**. For Google Calendar: Settings → Add
   calendar → From URL → paste the copied link (Google refreshes it about once a day).

Reading is read-only and refreshes every 10 minutes. MAAI can't edit Google or iCloud events; changes
there show in MAAI, and meetings MAAI books flow out through the link. Keep all these addresses
private: anyone with one can see your calendar. The sample events from the first run are hidden as
soon as a calendar is connected.

### Asana

MAAI lists the tasks assigned to you (overdue first) on Today, includes them in the morning briefing,
and, when you ask, reads a task and its comments, and prepares a **comment**, **mark done** or **new due
date** as an editable card. Nothing changes in Asana until you tap **Update in Asana**.

1. In Asana: your profile picture → **My Settings** → **Apps** → **Developer apps** →
   **Create new token**. Copy it once.
2. Add it as `ASANA_TOKEN` in `.env`, or on Render → **Environment**. Settings → Connections shows
   "Connected · N open tasks". Delete the token in Asana to cut MAAI off.

Ask things like *"What's overdue in Asana?"*, *"Read the Q4 report task"*, or *"Comment on the Q4
report task that I'll send it Thursday"*.

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
server/
  index.ts        Starts MAAI: at home, on the phone (HTTPS + PIN) or online (password)
  ai/             Everything that talks to Claude
    claude.ts     The API connection: requests, streaming, fallback, token counts
    context.ts    What Claude is told about your day and inbox
    tools.ts      Its tools (approval cards, reading an email)
    chat.ts       The assistant conversation
    mail.ts       Reply drafts and the inbox summary
    briefing.ts   The morning briefing
    demo.ts       Canned answers when there's no API key
  routes/         The /api endpoints, one file per screen, plus shared helpers (http.ts)
  store.ts        Data, saved to data/store.json (delete it to start fresh)
  auth.ts         Sign-in: PIN on the home Wi-Fi, password online
  phone.ts        HTTPS certificate, PIN and QR code for phone access
  notify.ts       Alert timing and Web Push (reminders, time to leave, prayers)
  mail.ts         Sending email through Gmail
  gmail-inbox.ts  Reading the Gmail inbox (IMAP, read-only)
  gcal.ts         Reading calendars (Google, iPhone/iCloud) through their private iCal links
  feed.ts         MAAI's own calendar as a private link the phone and Google subscribe to
  asana.ts        Asana tasks (read; changes only after you approve a card)
shared/           Types, prayer times (Umm al-Qura) and schedule rules, used by both sides
src/              React app
  screens/        Today, Assistant, Inbox, Settings
  components/     Cards, progress bubble, icons
  admin/          Admin portal
  api.ts          Calls to the server
  nav.ts          Moving between screens
```

The AI uses Claude (`claude-opus-5-5`) through the official Anthropic SDK. Its
tools are `propose_meeting`, `propose_reminder` and `propose_email`, and each just
creates a pending card; the server books, saves or sends only when you approve.
`read_email` lets it open an email from your inbox (read-only). Requests use the
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

Writing events straight into Google Calendar (it flows through the link above
instead), WhatsApp, Outlook, accounts for more than one person, and a native iPhone app. The old StockPlay
project is kept in `archive/stockplay`.
