# Idea: a US stock portfolio in «أسهمي»

Saved on 5 November 2026. **Phase 2a built on 9 November 2026:** a US paper desk in «أسهمي» (switch at the top of the
screen), $1,000 of paper money, at most $300 an order, whole shares, a halal list, the NYSE clock with daylight saving
and holidays, the S&P 500 as its market indicator, US news through web search. It runs as its own desk (its own file
`trading-us.json`, rounds folder, prices, limits, log and Stop), sharing the tested engine through a desk context
(`server/trading/desk.ts`). It cannot go live: no broker is connected.

The halal list (checked 9 November 2026; re-check each quarter against SP Funds' daily holdings file):
- ETFs: SPUS, HLAL, SPSK (sukuk), SPWO, SPTE, UMMA, SPRE, MNZL.
- Stocks, the largest held by SPUS (its Shariah board's screen passed them): NVDA, AAPL, MSFT, GOOGL, AVGO, TSLA, LLY,
  JNJ, XOM, HD, PG. Amazon and Meta were not found among SPUS holdings, so they are left out.

**Phase 2b built on 9 November 2026:** a crypto paper desk (the third switch): $1,000, at most $200 an order, fractions
of a coin (millionths), open around the clock (days start at midnight Riyadh), rounds every 30 minutes, a 3% daily
loss stop, the plain rule deciding by default (Claude can be chosen), news every 3 hours, Bitcoin as its market
indicator. Coins: BTC, ETH, SOL, XRP, ADA, AVAX, LINK, LTC (no lending or yield tokens, meme coins or exchange tokens;
crypto's permissibility is debated, and no Shariah board certifies these). Its own file `trading-crypto.json`.

Next: 2c US live through IBKR or Alpaca, 2d crypto live (trade-only key, no withdrawals, IP-locked).

## The reference: trader-skill

<https://github.com/Jakeschincariol/trader-skill> by Jake Schincariol, MIT licence. Reviewed at commit
`5189e79b9a480755a3733ac9713f5353981dbe18` (14 October 2026). Pin to a reviewed commit before reusing anything:
a later version may differ.

Eleven Claude skills, each a `SKILL.md` with a small standard-library Python tool, that read public US data and chain
through files in a `trader/` folder:

| skill | job | data it reads |
| --- | --- | --- |
| trader-copycat | Rebuild an investor's portfolio from its 13F-HR and diff it quarter to quarter | SEC EDGAR (13F information tables), OpenFIGI for share classes |
| trader-news | Headlines and 8-K filings for the stocks held | Yahoo Finance feeds, SEC EDGAR full-text search |
| trader-pelosi | Members of Congress's stock trades (House PTR PDFs) as they post | House Clerk disclosures (uses `pdftotext`) |
| trader-analyst | Reported revenue, net income, diluted EPS, margins, growth | SEC XBRL company facts |
| trader-screener | Rank companies against the user's rules | the analyst's metrics file |
| trader-budget | Size each position to a budget, with a cash buffer and a per-stock cap | prices (Yahoo, Stooq) |
| trader-risk | PASS or BLOCK each proposed order against limits | the orders file |
| trader-broker | Turn an approved order into the exact ticket for the broker's MCP tool; records the user's "yes" | none: it never places anything itself |
| trader-tax | Cost-basis lots, gains and losses, tax-loss harvesting, wash sales | the portfolio file |
| trader-alerts | Price targets, stops, the opening bell, with the real NYSE calendar | Yahoo, NYSE holidays |
| trader-rebalance | Trades to bring the book back to target weights past a drift band | the portfolio and targets |

**Safety, from reading the code:** network calls go only to the public sources above (sec.gov, data.sec.gov,
efts.sec.gov, disclosures-clerk.house.gov, Yahoo, Stooq, NYSE, OpenFIGI). No keys or user data are sent anywhere. The
only subprocess is `pdftotext`. Orders need three gates: the risk check passes that exact order, the user types yes,
and Claude's own "Allow once" card. The broker is Alpaca's official MCP server (paper by default) or Interactive
Brokers. It was a read-through, not a full security audit.

## How it would fit «أسهمي»

«أسهمي» already has the parts trader-skill splits into skills: the risk gate (trader-risk), limits per order, stock
and sector (trader-budget), the news agent (trader-news), and the user's approval before real money (typing LIVE).
A US book would add:

1. **A second market.** A universe of US stocks, the NYSE clock and holidays (as `tadawul.ts` does for Riyadh), prices
   in USD, and a separate paper book and limits, so a US loss never counts against the Saudi limits.
2. **A broker for it.** SNB Capital does not trade US stocks for us here: an executor for Alpaca (paper first) or
   Interactive Brokers, behind the same executor interface as the SNB bot, with the same "LIVE" confirmation.
3. **Data, reused as ideas, rewritten in TypeScript inside the server:**
   - 13F copycat: follow a fund's quarterly holdings and its changes (our «كبار الملاك» is the Saudi version).
   - 8-K filings as the US "official announcements".
   - XBRL company facts for the reference events the decision agent sees.
   - Congress trades (PTRs) as an optional, clearly labelled signal.
4. **US tax.** Lots, gains and wash sales matter for a US taxpayer; check first whether they apply to the user at all.

Not financial advice; copying an investor does not copy their results.
