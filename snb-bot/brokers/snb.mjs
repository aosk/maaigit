// The real SNB Capital part: logging in, placing the order, reading the confirmation, the portfolio and prices.
// NOT BUILT YET. It is written from your SNB screens (screenshots, or a Playwright recording of one small order by
// hand), because only you can see them. Until then the bot runs in practice mode only.
//
// What it will do, so you know what to expect:
//   session()  → is the SNB session still logged in (and for how long)
//   quotes()   → the live prices on your SNB screen for Istithmari's stocks
//   account()  → cash and holdings from SNB's own portfolio screen (Istithmari checks its book against this)
//   place(cmd, { beforeSubmit, sameOrder, progress })
//       open the order ticket → fill symbol, side, quantity, limit price → read the confirmation screen →
//       sameOrder(what it shows) must be true → await beforeSubmit() must be true → press Submit →
//       screenshot → read SNB's order number and the fill → return { status, filledQty, avgPrice, brokerOrderId }
//   Any screen it does not recognise: return { status: 'failed', error } and touch nothing else.
//
// Your SNB password and the OTP are typed by you, in the browser window on your computer. They are never stored by
// the bot and never sent to maai.
export function snbBroker() {
  throw new Error('The SNB part is not built yet: run in practice mode (SNB_BOT_PRACTICE=1) for now.');
}
