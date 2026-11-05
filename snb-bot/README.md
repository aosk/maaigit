# StockSmart SNB bot

Runs on your own computer. It takes the orders StockSmart sends, places them at SNB Capital, and reports back what
happened. It cannot decide, approve or change anything: StockSmart decides inside your limits, the risk gate checks,
and this bot only carries out a signed order, once.

**Status: the connection to maai is built and tested. The SNB part (its screens) is not built yet**, so the bot runs
in **practice mode** only: it goes through every step of each order and places nothing.

## Set it up (once)

1. Install **Node.js 22** or newer (nodejs.org). Use a computer that stays on and awake 10:00–15:00 Riyadh time,
   Sunday to Thursday (turn sleep off).
2. Copy this `snb-bot` folder to that computer.
3. In maai: **StockSmart → Limits and settings → Connect the SNB bot**. You get a key (`stk_…`) and a signing secret,
   shown once.
4. Copy `.env.example` to `.env` in this folder and paste the two in. Never share `.env` or paste it in a chat.
5. Check it: `npm run check` → `✓ Connected to StockSmart…`

## Run it

- Windows: double-click **start.bat**. Mac/Linux: `npm start`.
- It starts again by itself after a crash (in 30 seconds). It stops for good if its key is wrong or revoked.
- Stop it with Ctrl+C.
- You can see it in maai: Settings → Connections, and admin → Bots ("practice mode" while it practises).

## What it does

| Every | What |
| --- | --- |
| second (long-poll) | asks StockSmart for orders |
| minute | heartbeat: running, logged in at SNB or not, practice or not, SNB's live prices |
| 5 minutes | your account from SNB's own portfolio screen (StockSmart checks its book against it) |

For each order, in this order: check StockSmart's signature and that it has not expired → note it on disk →
"received" → fill the order form → compare SNB's confirmation screen with the order → ask StockSmart "still go?"
→ press Submit → screenshot → report the result.

## The safety rules it keeps

1. **Never twice.** Every order is noted in `data/commands.jsonl` before anything else; a repeat is ignored, even
   after a restart.
2. **Signed and on time.** An order whose signature does not match, or that expired, is refused.
3. **Asks right before Submit.** If you pressed Stop in maai while it was filling the form, it does not press Submit.
4. **Confirmation must match.** Any difference in symbol, side, quantity or price: it stops.
5. **Unknown screen = stop**, never a retry. If the bot is interrupted after Submit, that order is never tried again
   and is reported as **unknown** (SNB may have it): StockSmart keeps its cash and stock blocked and stops trading
   until the outcome is known, from the bot or from you after checking the SNB app.
5b. **Stop cancels at SNB.** An order resting at SNB (accepted, or partly filled) gets a signed cancel when you press
   Stop or when it expires; what already filled stays. Resting orders are looked up every 30 seconds until they end.
6. **Screenshot** of every submission, kept in `data/`.
7. **Dead-man switch.** If maai has not answered for 3 minutes, nothing is submitted. Results wait on disk and go
   out when maai is back.
8. **Your SNB account is the truth.** If it differs from what StockSmart expected, StockSmart stops trading and tells you.
9. **Logged out at SNB = real trading stops** until you log in again.

Your SNB password and OTP are typed by you, in the browser window on this computer. The bot never stores them and
never sends them anywhere.

## Practice, then real money

1. **Practice (now):** `SNB_BOT_PRACTICE=1`. Put StockSmart in LIVE with tiny limits if you like: every order goes
   through all the steps and ends as "Practice mode: not placed", so you see exactly what it would have done.
2. **The SNB part:** send screenshots of SNB's login, order entry, confirmation, open orders and portfolio screens
   (hide account numbers), or record one small order by hand with `npx playwright codegen`. That becomes
   `brokers/snb.mjs`.
3. **Real money:** `SNB_BOT_PRACTICE=0`, StockSmart limits at 1–2 orders a day of a few hundred riyals. Raise them
   from the app once a week of fills matches your SNB account.

Ask SNB Capital whether their terms allow automating your own account, or whether they offer an API.

## Files

- `bot.mjs` — starts it, reads `.env`. `start.mjs` / `start.bat` — keeps it running.
- `core.mjs` — the StockSmart side and the safety rules (tested against maai's server: `server/trading/snbBot.test.ts`).
- `ledger.mjs` — the record on disk. `brokers/practice.mjs` — practice. `brokers/snb.mjs` — SNB (to build).
- `data/` — the record, the log (`bot.log`) and screenshots. Keep it.

The protocol is in `docs/stocksmart-bot.md` in maai.
