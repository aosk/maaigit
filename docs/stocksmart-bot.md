# StockSmart — the SNB desktop bot protocol

The desktop bot runs on your own computer, logs in to SNB Capital, and places **only** the orders StockSmart sends it.
It can fetch commands and report what happened; it cannot propose, approve or change anything. Your broker login, OTP
and session cookies never leave the computer: the server has no endpoint that asks for them.

## Connecting

1. In maai: StockSmart → Settings → **Connect the SNB bot**. You get a **key** (`stk_…`) and a **signing secret**, shown once.
2. Give both to the bot (environment variables, never in code): `STOCKSMART_URL=https://maaigit.onrender.com`,
   `STOCKSMART_KEY=stk_…`, `STOCKSMART_SECRET=…`.
3. Every request carries `Authorization: Bearer <key>`. A new key stops the old one.

## The loop

```
every request ............ Authorization: Bearer stk_…
GET  /trade/v1/commands?wait=25     long-poll: returns at once if there are commands, else within 25 s
POST /trade/v1/ack                  { commandId }                       received (until then it is sent again)
GET  /trade/v1/go/:commandId        { go, reason? }                     ask right before pressing Submit
POST /trade/v1/progress             { commandId, stage }                "logging in", "form filled", "submitted"
POST /trade/v1/result               { commandId, status, filledQty?, avgPrice?, brokerOrderId?, error? }
POST /trade/v1/positions            { cash, positions: [{ symbol, qty, avgCost }] }   every few minutes
POST /trade/v1/heartbeat            { brokerSession, expiresInSec?, quotes?: [{ symbol, price, prevClose }] }  every minute
```

`status` is `filled`, `partial`, `rejected` (the broker refused it) or `failed` (the bot could not place it).

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
   what StockSmart expected, trading halts and you get a notification.
9. **Heartbeat** with `brokerSession: false` when you are logged out; the server halts real trading and asks the user
   to log in again (the OTP is on their phone).

## Before real money

Real trading needs, in maai: the bot connected, its heartbeat fresh, logged in at SNB, and the user typing **LIVE**.
Start with small limits (for example 1–2 orders a day of a few hundred riyals) and raise them from the app.

SNB Capital's terms may not allow automating its website; check with them, or ask whether they offer an API, which
would replace the browser automation and is far more reliable.
