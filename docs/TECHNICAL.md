# MAAI — Technical Overview

MAAI (Musaed Abdulrahman AI) is a personal assistant: a web app (installable on the iPhone home screen) backed by one Node server. It reads your calendar, Gmail and Asana, talks to Claude, and **never acts without your approval**.

## 1. Architecture

```
iPhone / browser (React PWA, src/)
        │  HTTPS, cookie session
        ▼
Express server (server/)
  site.ts ──► security headers ─► /api guard (auth.ts) ─► routes/*
                                                          │
          ┌───────────────┬──────────────┬───────────────┼──────────────┐
          ▼               ▼              ▼               ▼              ▼
      ai/ (Claude)    gmail/mail     gcal/livecal     asana.ts      notify.ts
      chat, tools     IMAP + SMTP    ICS + Google     Asana API     Web Push +
      briefing, mail                 Calendar API                   scheduler
                          │
                          ▼
                    store.ts  (one JSON file, atomic writes, 0600)
```

| Folder | Role |
|---|---|
| `shared/` | Types used by both server and app (`types.ts`) |
| `server/index.ts` | Starts the server (online: password; `npm run phone`: PIN on home Wi-Fi) |
| `server/site.ts` | Builds the Express app: headers, `/api` guard, JSON, error handlers |
| `server/auth.ts` | Sign-in guard: lockout, signed expiring session cookie |
| `server/security.ts` | Security headers/CSP, no-store, error handlers |
| `server/routes/*` | HTTP layer only: validate input, call a service, shape the reply |
| `server/ai/*` | Claude: chat loop (`chat.ts`), tools (`tools.ts`), briefing, mail help, prompt-injection guard (`untrusted.ts`) |
| `server/store.ts` | The only state: in-memory object, saved to `data/store.json` |
| `server/sync.ts` | Refreshes calendars, Asana, Gmail and pending Google writes (every 3 h, on pull-to-refresh, on demand) |
| `server/gcal.ts`, `livecal.ts`, `gwrite.ts`, `gauth.ts` | Calendar read (ICS + live API), write-back of approved meetings, service-account token |
| `server/news/*`, `server/ai/news.ts` | The News tab: reads a fixed list of trusted feeds every 6 h, ranks stories, Claude picks and summarises |
| `server/stress.ts` | The day-load (stress) score: plain arithmetic on events, tasks, email, WhatsApp, reminders and time pressure, each part capped; shown in the Today "Day load" card |
| `server/ai/facts.ts` | The counts and next event on the Today briefing card (no AI call), from `GET /api/briefing/facts` |
| `server/mail-handled.ts` | Remembers which inbox emails were dealt with (reply sent, meeting booked), so they leave "Needs your decision" |
| `server/anthropic-usage.ts`, `anthropic-limits.ts` | What Anthropic reports for the key MAAI uses: live rate limits (from response headers) and, with an Admin API key, tokens and cost (Admin API) |
| `server/ai/memo.ts` | Saved Claude answers (briefing, email and WhatsApp summaries), rewritten only when their data changes |
| `server/usage.ts` | Counts Claude tokens per day and feature (kept 90 days) for Admin → Token usage |
| `server/notify.ts` | Prayer/meeting/briefing alerts, Web Push |
| `src/` | React screens (Today, Assistant, Email, Settings, Admin), PWA service worker |

Layering rule: `routes → services (ai, asana, gcal…) → store`. No module imports "upward"; `madge` confirms there are no import cycles.

## 2. Key flows

**Chat with approval.** The user asks → `ai/chat.ts` streams to Claude with calendar/Asana/email context → Claude may call `read_*` tools (read-only, results returned to it) or `propose_*` tools. A `propose_*` call only creates a *pending card*; its tool result tells Claude "waiting for the user". The user taps Approve → `routes/chat.ts` performs the action (send email, add meeting + Google write, save reminder, Asana update/create) and records it in the audit log. Loop is capped at 6 rounds; a failed turn rolls the conversation back.

**Calendar sync.** ICS feeds are read every sync. If a Google service account is configured, the calendar is also read live through the Events API every 60 s, replacing the ICS copy of the same calendar while healthy; adds, moves and deletions made on the phone appear within a minute. Meetings MAAI wrote are reconciled (moved/renamed/deleted on the phone ⇒ followed in MAAI).

**WhatsApp.** People write to the business number; Twilio POSTs each message to `/webhook/whatsapp`. That one route sits outside the password gate (Twilio cannot sign in), so every request must carry a valid `X-Twilio-Signature` (HMAC-SHA1 of the URL and form fields with the auth token) or it gets 403. Messages are stored in the inbox (`via: 'twilio'`), deleted after `MAAI_WHATSAPP_DAYS`, capped at 500, and answered automatically only with one fixed "received" note (English or Arabic, once per person per 6 hours, `MAAI_WHATSAPP_ACK=off` to disable) returned as TwiML in the webhook reply; the sender's words never enter it. `GET /api/whatsapp/digest` has Claude group them per person and rank them (decide / reply / FYI / ignore, high / normal / low). The user edits a draft and taps Send → `POST /api/inbox/:id/whatsapp` sends through Twilio, only inside WhatsApp's 24-hour answer window, and is audited. The assistant chat can do the same through `read_whatsapp` and `propose_whatsapp` (an editable card; sent only on approval). Waiting messages also feed the daily briefing. MAAI sees only messages sent *to the business number*, not personal chats.

**Photos and documents.** The paperclip in the assistant sends a photo (resized in the browser to 1800 px, JPEG) or PDF to `POST /api/uploads`. The server identifies the type by its first bytes (never by name or header; anything but JPEG/PNG/GIF/WEBP/PDF is refused), keeps the file **in memory only** (images 5 MB, PDFs 10 MB, at most 12 files / 40 MB held, 30 minutes) and returns an id. `/api/chat/stream` accepts up to 4 ids; Claude reads the file natively (including Arabic and English text in photos, so no separate OCR engine), briefs it, and may call `propose_reminder` / `propose_asana_task`, which only make approval cards. After the answer the file is released and its content is replaced in the stored conversation by a placeholder; only the file name is saved. Text inside a file is untrusted and named as such in the system prompt. Photos and PDFs cost more tokens (scanned multi-page PDFs the most); they show under "Assistant chat" in Admin → Token usage.

**Voice.** Browser dictation (`src/speech.ts`) listens for one language; its result list is assembled by `assembleHeard` (`src/voice.ts`), because Android's recogniser reports the whole sentence again in every entry, which used to repeat the first word dozens of times (Android also gets `continuous=false`). With `STT_API_KEY` set (`server/stt.ts`, `POST /api/transcribe`) the microphone is recorded (`src/recorder.ts`, with the loudness gate in `src/vad.ts`), checked by its first bytes, sent to an OpenAI-style `/audio/transcriptions` service with no language forced and a hint made of the user's names, projects and meeting titles, and the words come back. Dictated messages are marked for Claude (`voiceNote`), and the system prompt explains mixed-language use and dictation mistakes. Spoken replies pick the voice per sentence by script (`scriptOf`).

**Sessions and sign-out.** A session cookie is `expiry.signature` (HMAC over the expiry, the passcode hash and a sign-out counter `state.sessionEpoch`). **Sign out raises the counter, which ends every session on every device**, including a copied cookie (found by the penetration test); only a request with a valid session can raise it. The Face ID challenge endpoint is limited to 20 requests a minute per address, failed Face ID tries are counted per address, and a full challenge list refuses new ones instead of dropping the owner's. The calendar link is built from `MAAI_PUBLIC_URL` / `RENDER_EXTERNAL_URL`, never from the Host header.

**Screen layouts.** `src/layout.ts` maps the window width to `phone` (<600), `tablet` (600–1023) or `desktop` (≥1024); `settings.layout` is `auto` or one of them. `SettingsProvider` listens to `resize`, and writes the result to `<html data-layout>`; `styles.css` keeps the phone design as the base and widens it under `[data-layout='tablet'|'desktop']` (CSS columns for the card screens marked `.screen.cols`, a grid with a side rail for the tabs on desktop). Right-to-left works unchanged because the rules use logical properties and grid order.

**Profile (what MAAI knows about the user).** `server/profile.ts` keeps short facts (`state.profile`, in `store.json` on the Render disk): each has a category, who wrote it (the user, or MAAI's suggestion that the user approved), a pin, and a use count. Facts are added in three ways only: typed in Settings → "What MAAI knows about me" (`/#/profile`, `routes/profile.ts`), or by the assistant's `propose_remember` tool, which makes an editable approval card and keeps nothing until approved. Nothing is learned silently. Before saving, `cleanFact` refuses passwords, API keys, long digit runs (ID, card, account, phone), IBANs and health details in English and Arabic, and anything over 200 letters; duplicates are merged; the limit is 150 facts. For each chat message `pickFacts` chooses at most 12 facts / 1,500 characters (pinned ones, those sharing words with the question after Arabic normalisation, then a few general ones) and `aboutTheUser` adds them inside `<context>` as `<about_the_user>`, with the tag defused by `neutralize()` and the system prompt saying they are background, never orders. The profile can be paused (no facts sent), exported as JSON, edited, deleted one by one, or wiped; every change is in the audit log. It does not train or change Claude; it is memory that is read back, so a wrong fact is fixed by editing it.

**Saved answers (cache).** Claude's briefing, email summary and WhatsApp summary are kept with a fingerprint of the data they were written from (`remember()` in `server/ai/memo.ts`). Same data, same language and time of day gives the saved answer back with no call; new mail, a new message, a changed event, reminder or Asana task, or a new part of the day gives a new fingerprint and a new answer. The briefing also expires after 3 hours. Answers are saved in `store.json`, so restarts and deploys keep them; simultaneous requests share one call; failures and empty answers are not kept. Each reuse is counted and shown as "Reused" in Admin → Token usage.

**News.** `server/news/sources.ts` is the only list of places MAAI reads news from (AI and technology: MIT Technology Review, Ars Technica, BBC News Technology, The Verge, TechCrunch, OpenAI, Google DeepMind; Saudi Arabia: Saudi Press Agency, Arab News, Saudi Gazette, Asharq Al-Awsat, Al Arabiya). Every `MAAI_NEWS_HOURS` (6) the server reads each feed over https only, with a time and size limit, following redirects only within the source's own sites; for each source it tries its known feed addresses, then any feed its front page advertises. Stories older than 4 days, or whose link leaves the source's own site, are dropped, and region-wide feeds are filtered to Saudi topics. Stories are clustered by headline similarity and ranked by recency, source weight, how many sources carried them and topic; Claude then picks and summarises the top 8 per section in the app language (saved with `remember()`, so it is asked again only when the stories change). Headlines are untrusted text (`<news_item>`). A source that fails keeps its earlier headlines and is shown as failing in the News tab and in Admin.

**Notifications.** A 30-second scheduler checks prayer, meeting and briefing times and sends Web Push (morning/noon/night briefing text generated by Claude). Push endpoints must be on a known push-service host.

## 3. Security model

1. **Default-deny API.** The guard is mounted on `/api` itself with case-sensitive routing; every route needs a valid session except `/api/health`, `/api/unlock`, `/api/logout`.
2. **Sessions.** Cookie `expiry.HMAC` (30 days, renewed after 15), HttpOnly, Secure, SameSite=Strict. Changing the password invalidates all sessions.
2b. **Face ID (passkeys).** Optional sign-in with Face ID or a fingerprint (WebAuthn, `server/passkeys.ts`). The phone keeps the private key behind Face ID; MAAI stores only the public key. Sign-in verifies a fresh signature over a one-time, 5-minute challenge for this site's origin with user verification required, checks the signature counter, and then issues the same session cookie as the password. Once at least one device is set up, MAAI also locks itself: every request needs a second short-lived signed cookie (`maai_face`, `MAAI_LOCK_MINUTES`, default 5) that only Face ID or the password issues and that real use renews (the app's automatic refreshes, marked `X-Maai-Background`, do not), so an app left open locks too. Setting it up needs a password session; at most 5 devices; 10 wrong tries in 10 minutes pause it. The password always keeps working.
3. **Brute force.** 5 wrong tries → locked 1 min, doubling each round up to 1 h.
4. **Approval principle.** Claude can only *propose*. Buttons you tap (Asana complete/status/date) are audited.
5. **Untrusted text.** Emails, Asana text and calendar notes are wrapped in tags and neutralised before reaching Claude; the system prompt names them as data, not instructions. Links shown to the user must be http(s).
6. **Headers.** CSP, HSTS, nosniff, frame deny, no-referrer, Permissions-Policy, COOP/CORP; `/api` is `no-store`.
7. **Errors.** Unexpected errors return a generic 500; stack traces and messages never leave the server.
8. **Data at rest.** `store.json` written atomically with mode 0600; a corrupt file is kept as `store.json.damaged-<time>` instead of overwritten; flushed on shutdown.
9. **Secrets** live only in environment variables (Render → Environment, or `.env`). Never in code or chat. The repo is public.

## 4. Configuration

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude (without it: demo mode) |
| `ANTHROPIC_ADMIN_KEY` | Optional Admin API key: lets Admin → Anthropic account show your usage and cost from Anthropic (organization accounts only) |
| `MAAI_PASSWORD` | Online sign-in password |
| `MAAI_PIN`, `MAAI_PHONE`, `MAAI_PHONE_PORT` | Home-Wi-Fi mode |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Send/read mail |
| `GOOGLE_CALENDAR_ICS_URL` | Read-only calendars (secret iCal links) |
| `GOOGLE_SERVICE_ACCOUNT`, `GOOGLE_CALENDAR_ID` | Write + live read of Google Calendar |
| `ASANA_TOKEN` | Asana |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | WhatsApp Business number via Twilio |
| `MAAI_LOCK_MINUTES` (5) | Once Face ID is set up: minutes unused before MAAI asks for Face ID again |
| `MAAI_PUBLIC_URL` | Only if Face ID fails behind a custom domain or proxy: the address you open MAAI at |
| `MAAI_WHATSAPP_ACK` (on) | The automatic "received" note |
| `MAAI_WHATSAPP_DAYS` (7) | Days received WhatsApp messages are kept |
| `WHATSAPP_WEBHOOK_URL` | Only if a proxy changes the address Twilio signs |
| `MAAI_SYNC_HOURS` (3), `MAAI_LIVE_SECONDS` (60) | Refresh cadence |
| `MAAI_LATITUDE/LONGITUDE/TIMEZONE` | Prayer times |
| `MAAI_DATA_DIR`, `MAAI_DATA_FILE` | Where data is kept (use a persistent disk on Render) |
| `NODE_ENV` | `production` is the default when online |

## 5. Quality commands

| Command | What it does |
|---|---|
| `npm run check` | Types + lint + all tests + dead-code scan + dependency audit (run before every push; the same runs in GitHub Actions) |
| `npm run lint` | ESLint with type-aware rules (forgotten `await`, unhandled promises, unsafe `any`) and React hook rules; 0 errors required, a few React-Compiler warnings are known |
| `npm test` | 430+ tests: unit, API, security, fuzz, injection, assistant approval flow, double-tap and concurrency, storage failures |
| `npm run test:security` | Only the security suites |
| `npm run coverage` | Coverage report (now ≈57% statements; server/routes 84%, auth/store/sync ≈100%) |
| `npm run unused` | knip: unused files/exports/dependencies |
| `npm run audit:deps` | Known-vulnerability scan of production dependencies |

Security suites: every API route is called without a session in 16 URL disguises (case, encoding, slashes…) and must refuse; hostile bodies/ids/queries must never cause a 500; header and cookie flags; secrets never appear in responses; prompt-injection guards; the assistant can never act before approval. Accessibility was checked with axe-core on all screens (en/ar, light/dark): no violations.

## 6. Runbook

- **Deploy:** push to GitHub `main`; Render rebuilds. Env vars are set in Render → Environment.
- **Rotate a secret:** create the new one at its provider, paste it into Render, redeploy, revoke the old one. Changing `MAAI_PASSWORD` signs out every device.
- **Data resets at every update:** the service has no persistent disk (a service made by hand, not from `render.yaml`, has none). Settings → Connections shows "Saved data" in red, and the server logs a WARNING at start. Fix: Render → the service → **Disks → Add Disk** (mount path `/var/data`, 1 GB, needs a paid plan), then add `MAAI_DATA_DIR=/var/data`.
- **Data damaged:** look for `store.json.damaged-*` next to `store.json`.
- **Calendar not matching:** Settings shows the live-read health; check the calendar is shared with the service account.

## 7. Known limits & improvement backlog

**From the latest expert review (open):** the passkey `login/options` route has no per-IP rate limit and one global failure counter; upstream failures (Gmail, Twilio, Asana) answer 400 rather than 502; reading one email can overwrite the shared 14-day inbox cache; `fetch` calls to Google have no timeout; WhatsApp digest results are cached even when empty; the 14 React-Compiler lint warnings (refs-in-render, set-state-in-effect); pasted-message delete has no undo; out-of-order responses on rapid language switches; the edit sheet has no focus trap; admin screens are English only.

1. Single user, single global state (`state` in `store.ts`) — multi-user needs a repository layer and a database.
2. Lockout is global (an attacker could lock you out for minutes); make it per-IP and add a passkey/2FA login. Enforce a 12+ character password.
3. No server-side "sign out everywhere" (only by changing the password).
4. Long conversations are sent to Claude in full: add trimming/summarising to cap cost.
5. No rate limit on expensive endpoints (`/chat/stream`, `/mail/digest`); AI calls are not aborted when the client disconnects.
6. `notify.ts` (alerts + push) and `routes/chat.ts` (approval logic) should be split into smaller services; `shared/types.ts` by domain.
7. UI tests (Playwright + axe) are ad-hoc; move into the repo and a CI pipeline running `npm run check`.
8. Add data export/backup, and WhatsApp via a "Send to MAAI" Shortcuts share button.
