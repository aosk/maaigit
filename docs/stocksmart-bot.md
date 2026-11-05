# maai Stocks — the SNB desktop bot protocol

The bot itself is in `snb-bot/` (its README says how to set it up). This page is the protocol it speaks.

The desktop bot runs on your own computer, logs in to SNB Capital, and places **only** the orders maai Stocks sends it.
It can fetch commands and report what happened; it cannot propose, approve or change anything. Your broker login, OTP
and session cookies never leave the computer: the server has no endpoint that asks for them.

## Connecting

1. In maai: maai Stocks → Settings → **Connect the SNB bot**. You get a **key** (`stk_…`) and a **signing secret**, shown once.
2. Give both to the bot (environment variables, never in code): `STOCKSMART_URL=https://maaigit.onrender.com`,
   `STOCKSMART_KEY=stk_…`, `STOCKSMART_SECRET=…`.
3. Every request carries `Authorization: Bearer <key>`. A new key stops the old one.

## The loop

```
every request ............ Authorization: Bearer stk_…
GET  /trade/v1/commands?wait=25     long-poll: { commands, cancels, halted, mode, serverTime }
POST /trade/v1/ack                  { commandId, kind? }                received ("cancel" for a cancel); until then it is sent again
GET  /trade/v1/go/:commandId        { go, reason? }                     ask right before pressing Submit
POST /trade/v1/progress             { commandId, stage }                "logging in", "form filled", "submitted"
POST /trade/v1/result               { commandId, status, filledQty?, avgPrice?, brokerOrderId?, error? }
POST /trade/v1/positions            { cash, positions: [{ symbol, qty, avgCost }] }   every few minutes
POST /trade/v1/heartbeat            { brokerSession, expiresInSec?, practice?, quotes?: [{ symbol, price, prevClose }] }  every minute
```

`status` is one of:

| status | meaning |
| --- | --- |
| `accepted` | at SNB, not filled yet (the bot keeps following it) |
| `partial` / `filled` | filled so far / completely, with `filledQty` and `avgPrice` |
| `cancelled` | cancelled at SNB (what filled before stays) |
| `rejected` | SNB refused it |
| `failed` | it never reached SNB (stopped before Submit) |
| `unknown` | it may have reached SNB: cut off after Submit, or a cancel that could not be confirmed |

`unknown` keeps the order's cash and stock blocked and stops trading until the bot reports the real outcome or the
user, having checked the SNB app, says whether it was executed. **After Submit, never report `failed`.**

## A cancel

```json
{ "commandId": "ord_0123456789abcdef", "issuedAt": "2026-11-04T08:47:00.000Z", "sig": "…" }
```

`sig` = HMAC-SHA256 (hex) of `cancel|commandId|issuedAt`. Sent when the user presses Stop, or when an order the bot
has reaches its expiry (it may be resting at SNB), and again every minute until acknowledged with `kind: "cancel"`.
The bot cancels it at SNB if it is there and not finished, and reports `cancelled` (or what actually happened). A
cancel for an order the bot never received is noted, so that order is refused if it ever arrives.

## A command

```json
{ "commandId": "ord_0123456789abcdef", "symbol": "2222", "side": "buy", "qty": 60, "limitPrice": 27.45,
  "issuedAt": "2026-11-04T08:43:00.000Z", "expiresAt": "2026-11-04T08:53:00.000Z", "sig": "…" }
```

`sig` = HMAC-SHA256 (hex) with the signing secret of
`commandId|symbol|side|qty|limitPrice(2 decimals)|issuedAt|expiresAt`. **Reject any command whose signature does not match.**

## Rules the bot must keep (each one prevents a real-money accident)

1. **Never place a command twice.** Keep every `commandId` you have seen in a file on disk (not memory), and ignore a
   repeat. The server re-sends anything you have not acknowledged; this rule is what makes that safe.
2. **Check the signature and `expiresAt`** before doing anything. Expired means never place it.
3. **Ask `/go/:commandId` immediately before Submit.** The user may have pressed Stop while you were filling the form.
4. **Compare the confirmation screen** with the command: symbol, side, quantity, price. Any difference is `failed`, never a fill.
5. **Any screen you do not recognise is a stop**, never a retry: report `failed` and wait. Retrying into an unknown
   state is how one order becomes three.
6. **Screenshot every submission** and keep it locally with the `commandId` and `brokerOrderId`.
7. **Dead-man switch:** if the server has not answered for 3 minutes, stop placing anything until it answers again.
8. **Report the account** (`/positions`) every few minutes from the broker's own portfolio screen. If it differs from
   what maai Stocks expected, trading halts and you get a notification.
9. **Heartbeat** with `practice: true` while it only practises (shown in maai), and `brokerSession: false` when you are logged out; the server halts real trading and asks the user
   to log in again (the OTP is on their phone).

## Before real money

Real trading needs, in maai: the bot connected, its heartbeat fresh, logged in at SNB, and the user typing **LIVE**.
Start with small limits (for example 1–2 orders a day of a few hundred riyals) and raise them from the app.

SNB Capital's terms may not allow automating its website; check with them, or ask whether they offer an API, which
would replace the browser automation and is far more reliable.
