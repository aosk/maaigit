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

**Daily briefing:** turn on *Daily briefing* in Settings → Notifications and pick a time (default 07:00).
At that time MAAI re-reads your calendars, Asana and Gmail, writes the briefing for that time of day
(*Morning*, *Noon* or *Night*), and sends it as a notification, once a day, in the language each device
uses. **Send me the briefing now** sends one immediately to check it works. If Claude can't be reached at
that moment, the notification still arrives and points you to the app. It is sent only if the server is
running at that minute (online on Render, that means always; a computer at home has to be on).

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
| **Google (Gmail) Calendar** | **Live** (about every minute) once *Write meetings into Google Calendar* is set up below; otherwise its private address, `GOOGLE_CALENDAR_ICS_URL` (Google can be slow to update that, even hours) | Google ↔ MAAI |
| **iPhone calendar** | If the phone uses your Google account, it's the same calendar as above. For an iCloud calendar, share it publicly (below) and add that link too | Phone → MAAI |
| **Meetings MAAI books** | Written straight into your Google Calendar (below), so they show up on the iPhone too if it uses your Google account. Without that: a private link the phone and Google subscribe to (Settings → *MAAI calendar on your phone*) | MAAI → Google and phone |

1. **Google:** Google Calendar on a computer → gear → **Settings** → your calendar under
   *Settings for my calendars* → **Integrate calendar** → copy **Secret address in iCal format**.
2. **iPhone:** easiest is to make the phone use Google: iPhone Settings → Calendar → Accounts →
   Add Account → Google, and switch Calendars on. Then the phone, Google and MAAI agree. For an
   iCloud calendar instead: Calendar app → Calendars → (i) next to it → **Public Calendar** → copy
   the link (it starts `webcal://`).
3. Put every address in `GOOGLE_CALENDAR_ICS_URL` (`.env`, or Render → **Environment**), separated by
   spaces. Settings → **Connections** then lists each calendar with its event count, a ✗ if one
   can't be read, and how many repeated meetings were shown once.
4. **MAAI → Google:** follow *Write meetings into Google Calendar* below. Without it, meetings booked in
   MAAI stay in MAAI; the subscription link (Settings → **Add to iPhone Calendar**, or in Google Calendar:
   Settings → Add calendar → From URL) only reaches Google about once a day.

**Live sync.** With the Google service account set up, MAAI reads your calendar through it about once a
minute (`MAAI_LIVE_SECONDS`), instead of through the private address, which Google can leave out of date.
What you add, move or delete on your iPhone shows up in MAAI within about a minute, as long as the iPhone
puts that event in your **Google** calendar (iPhone Settings → Calendar → **Default Calendar** → your Google
calendar; the Google account must be added under Calendar → Accounts). Meetings MAAI wrote to Google follow
too: move, rename or delete one on the phone and MAAI's copy changes with it. If the live reading ever fails,
Settings shows why and the private address takes over until it works again. Events kept only in iCloud or
"On My iPhone" can't be seen live: move them to the Google calendar.

Without the service account, reading refreshes every 10 minutes. MAAI never edits events you made in Google or iCloud; changes there
show in MAAI, and the meetings MAAI creates go out as described below. Keep all these addresses
private: anyone with one can see your calendar. The sample events from the first run are hidden as
soon as a calendar is connected.

### Write meetings into Google Calendar

With this on, a meeting you approve in MAAI (or a focus block you add on Today) appears in your Google
Calendar within seconds, and on every device that shows it, such as the iPhone Calendar when the phone
uses your Google account. Deleting it in MAAI removes it from Google. If Google can't be reached, the
meeting is still saved in MAAI, the card says so, and MAAI retries every 30 minutes. At start-up MAAI also
sends any upcoming meetings it made earlier that Google doesn't have yet.

It signs in as a "service account", a robot account you create once. There is no sign-in screen and
nothing that expires.

1. Open <https://console.cloud.google.com>, sign in with the Google account that owns the calendar, and
   create a project (name it MAAI).
2. **APIs & Services → Library**, search **Google Calendar API**, click **Enable**.
3. **IAM & Admin → Service Accounts → Create service account**. Name it `maai`, click **Done** (no roles needed).
4. Click the new account → **Keys → Add key → Create new key → JSON → Create**. A file downloads.
5. Open the downloaded file in Notepad and copy the `client_email` value (like
   `maai@your-project.iam.gserviceaccount.com`).
6. Google Calendar on a computer → **Settings** → your calendar under *Settings for my calendars* →
   **Share with specific people or groups → Add people** → paste that email → permission **Make changes to
   events** → **Send**.
7. On the same settings page, under **Integrate calendar**, copy the **Calendar ID** (usually your Gmail address).
8. On Render → **Environment**, add `GOOGLE_SERVICE_ACCOUNT` (paste the **whole contents** of the downloaded
   file) and `GOOGLE_CALENDAR_ID` (the ID from step 7). **Manual Deploy**.

Settings → **Connections → Calendars** then shows "Meetings you book are added to …", or the exact reason
it can't (for example, which email to share the calendar with). The downloaded key is a password for your
calendar: keep it only in Render, never in GitHub or a chat, and delete it in Google Cloud to cut MAAI off.
Don't also subscribe Google Calendar to MAAI's link: each meeting would show twice.

### WhatsApp Business (through Twilio)

MAAI reads the messages people send to your **WhatsApp Business number**, summarises them, ranks them by
importance (decide / reply / for your information / skip), and helps you answer. It cannot see your
personal WhatsApp chats, and it never sends anything by itself: you edit the draft and tap **Send on WhatsApp**.

1. Create a Twilio account and note the **Account SID** and **Auth Token**. To try it first, use Twilio's
   WhatsApp sandbox (Messaging → Try it out → Send a WhatsApp message); for real use, register your business number as a sender.
2. On Render → **Environment** add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_WHATSAPP_FROM`
   (like `whatsapp:+9665XXXXXXXX`). Never put them in the code or in chat.
3. In Twilio, set the incoming-message webhook (method POST) to `https://YOUR-APP.onrender.com/webhook/whatsapp`.
4. The first time someone writes (and again after 6 hours), MAAI sends one fixed note: *"This is MAAI, the AI assistant of
   Abdulrahman. Your message was received and he will get back to you as soon as possible."* (in Arabic if they wrote in
   Arabic). It is the only thing MAAI sends on its own. Set `MAAI_WHATSAPP_ACK=off` to turn it off.
   You can also ask the assistant chat: *"Reply to Ahmed on WhatsApp"*. It reads the conversation and shows an editable card.
5. Open **Inbox → WhatsApp**. Messages are deleted after 7 days (`MAAI_WHATSAPP_DAYS`).
6. WhatsApp only lets a business answer freely within 24 hours of the person's last message; after that MAAI
   offers "Open in WhatsApp" so you write to them yourself.

### Face ID instead of the password

Online, open **Settings → Face ID → Set up Face ID** (on the iPhone, from the Home Screen icon or Safari) and approve with
Face ID. From then on the sign-in screen has a **Sign in with Face ID** button. MAAI keeps only a public key, never your face
or fingerprint; the password still works. Remove a device any time in the same place.

### Day load (stress level)

Today shows a **Day load** card: a score out of 100 (Calm, Steady, Busy, Heavy) with a gauge, the one or two things driving it,
and a one-line suggestion. Open "What it is made of" to see every part and its share, plus the highest score of each of the last
seven days. It is plain arithmetic on what MAAI already knows (no AI), and no part can count for more than its ceiling:
meetings ahead and back-to-back ones (25), tasks (25: overdue count most), email needing a decision or an answer (20),
WhatsApp people waiting (15), reminders due today (10) and something starting within the hour (5). Every section on Today
and every Inbox tab also has a coloured count badge.

### Anthropic account usage (Admin → Anthropic account)

The admin portal shows what **Anthropic itself** reports for the key MAAI uses:
- **Rate limits, live:** how much of the key's request and token allowance is left, taken from the headers Anthropic sends with every answer. No extra setup.
- **Tokens and cost, last 30 days:** needs an **Admin API key** (Claude Console → Settings → Admin keys; organization accounts only, not individual ones). Add it on Render as `ANTHROPIC_ADMIN_KEY`. MAAI finds which key in your organization is its own by how it starts and ends, and shows that key's tokens per day next to what MAAI itself counted. Anthropic reports **cost** only for the whole organization, so that number is the organization's. An Admin key can manage the organization: add one only if you are comfortable, and delete it in the Console to cut MAAI off.
- Your **remaining prepaid credit** is not available through any API. See it in the Claude Console under Usage and Cost.

### Photos and documents

Tap the **paperclip** in the assistant, pick a photo (a bill, a letter, a screenshot) or a PDF, and send. MAAI reads it, including Arabic and English text, gives you a short brief, and prepares a **reminder** (for a date or deadline) or an **Asana task** (for work to do) as a card you approve. Up to 4 files per message, photos up to 5 MB, PDFs up to 10 MB. Files are held in the server's memory for at most 30 minutes and are never saved; only the file name stays in the chat. Photos and PDFs use more of your Claude allowance than plain text.

### News

The **News** tab has two sections: **AI & Tech** and **Saudi Arabia**. MAAI reads only a fixed list of trusted sources (listed
at the bottom of the tab, and in `server/news/sources.ts`), every 6 hours (`MAAI_NEWS_HOURS`), and shows the eight most
important stories in each section, with a one-sentence summary in your language and "also reported by" when several sources
carried the story. Tap a story to read it on the source's own site. **Refresh** reads the sources again now. If a source stops
working, the tab shows which one. Set `MAAI_NEWS=off` to turn the section off.

### Reading voice

MAAI reads the briefing and replies with the best voice installed on the device and says each sentence on its own, with
natural pauses. **Settings → Reading voice** lets you pick another English or Arabic voice and listen to it. For a much more
human sound on iPhone, download a better voice: Settings → Accessibility → Spoken Content → Voices → English or Arabic → pick one
marked **Enhanced** or **Premium** (for example Ava, Zoe, or Majed), then reopen MAAI.

### Alert sound

Alerts arrive as push notifications titled like reminders (⏰ Reminder, 🚗 Time to leave…). With MAAI closed, the iPhone plays
its own notification sound: a web app cannot choose it (check Settings → Notifications → MAAI → Sounds, and that Focus is off).
With MAAI open, it plays its own soft two-note chime (Settings → Notifications → MAAI chime).

### Asana

MAAI lists the tasks assigned to you (overdue first) on Today and includes them in the morning briefing.

- **Buttons on Today:** tap the circle to mark a task done (with **Undo** for 10 seconds). Tap a task's
  name to change its **status** (its column on the project's board, such as To do / In progress / Done,
  and any dropdown field such as Priority) or its **due date**. **New task** adds one, with an optional
  project and date. These are your own taps, so they apply straight away and are logged in the admin
  audit log.
- **Ask the assistant:** *"What's overdue in Asana?"*, *"Read the Q4 report task"*, *"Comment on the Q4
  report task that I'll send it Thursday"*, *"Add a task to book the venue in Ops, due next Sunday"*. The
  assistant never changes Asana by itself: it shows an editable card (a comment, mark done, new date, or
  a new task) and acts only when you tap **Update in Asana** or **Create task**.

1. In Asana: your profile picture → **My Settings** → **Apps** → **Developer apps** →
   **Create new token**. Copy it once.
2. Add it as `ASANA_TOKEN` in `.env`, or on Render → **Environment**. Settings → Connections shows
   "Connected · N open tasks". Delete the token in Asana to cut MAAI off.

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

## Staying up to date

- **In the background:** every 3 hours the server re-reads your calendars, Asana and Gmail, and sends
  Google any meetings it is missing, even when the app is closed. Change the interval with
  `MAAI_SYNC_HOURS` (minimum 0.25). Each source is separate: one failing never stops the others. The audit
  log records each background refresh.
- **Pull down to refresh:** at the top of Today, Inbox or Settings, pull down (an installed iPhone app has no
  built-in pull-to-refresh, so MAAI adds one). It re-reads everything now and shows "Up to date", or "Some
  things could not be updated". Today's footer shows when the last refresh happened.
- **Coming back:** after you've been away from the app for 10 minutes, it refreshes by itself.
- **Event details:** tap any event on Today for its time, place, notes (links are tappable) and a **Join
  meeting** button when it has a Google Meet, Zoom, Teams or Webex link. Notes stay on screen only; the
  assistant never reads them as instructions.
- **Briefing:** the card is *Morning briefing* until 12:00, *Noon briefing* until 18:00 and *Night briefing*
  after, and it is written for that time: the day ahead, what is left of it, or a wrap-up plus tomorrow.

## What's in it

| Screen | What it does |
|---|---|
| **Today** | Gregorian and Hijri date, an AI briefing (morning, noon or night) you can listen to, the day's schedule with the five prayer times marked as protected, "leave by" hints, a free-time suggestion, reminders. |
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
  gauth.ts        Signing in to Google Calendar as a service account
  gwrite.ts       Writing the meetings you approve into Google Calendar
  livecal.ts      Reading Google Calendar live, and keeping MAAI's meetings in step with it
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

WhatsApp, Outlook, accounts for more than one person, and a native iPhone app. The old StockPlay
project is kept in `archive/stockplay`.
