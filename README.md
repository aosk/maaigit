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

Other settings in `.env`: `PORT`, and `MAAI_LATITUDE` / `MAAI_LONGITUDE` /
`MAAI_TIMEZONE` for prayer times (default Riyadh).

| Command | Does |
|---|---|
| `npm run dev` | Runs the app with live reload |
| `npm start` | Builds and runs the production version |
| `npm test` | Runs the tests |
| `npm run typecheck` | Checks the TypeScript |

## Not built yet

Connecting real Google / Outlook calendars and email, push notifications,
sign-in for more than one user, and a native iPhone app. The old StockPlay
project is kept in `archive/stockplay`.
