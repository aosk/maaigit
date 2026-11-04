// StockSmart's SNB bot: start with `npm start` (or start.bat on Windows). Settings come from .env in this folder.
// `npm run check` only checks the settings and the connection to maai, then exits.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBot } from './core.mjs';
import { openLedger } from './ledger.mjs';
import { practiceBroker } from './brokers/practice.mjs';
import { snbBroker } from './brokers/snb.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.SNB_BOT_DATA || path.join(HERE, 'data');
const SETUP_PROBLEM = 1;

// .env next to the bot, without a library: KEY=value lines, # comments.
const envFile = path.join(HERE, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

fs.mkdirSync(DATA, { recursive: true });
const logFile = fs.createWriteStream(path.join(DATA, 'bot.log'), { flags: 'a' });
const log = (text) => {
  const line = `${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Riyadh' })}  ${text}`;
  console.log(line);
  logFile.write(line + '\n');
};

function setup(message) {
  console.error(`\n✗ ${message}\n  See README.md in this folder.\n`);
  process.exit(SETUP_PROBLEM);
}

const url = process.env.STOCKSMART_URL ?? '';
const key = process.env.STOCKSMART_KEY ?? '';
const secret = process.env.STOCKSMART_SECRET ?? '';
if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url)) setup('STOCKSMART_URL is missing or not https (for example https://maaigit.onrender.com).');
if (!/^stk_\S{20,}$/.test(key)) setup('STOCKSMART_KEY is missing. Make it in maai: StockSmart → Limits and settings → Connect the SNB bot.');
if (!/^[0-9a-f]{64}$/.test(secret)) setup('STOCKSMART_SECRET is missing or not the 64-character signing secret shown with the key.');

const practice = process.env.SNB_BOT_PRACTICE !== '0';
let broker;
try {
  broker = practice ? practiceBroker({ log }) : snbBroker({ log, dataDir: DATA });
} catch (error) {
  setup(error.message);
}

const ledger = openLedger(DATA);
const bot = createBot({ url, key, secret, broker, ledger, log });

if (process.argv.includes('--check')) {
  try {
    await bot.heartbeat();
    const s = bot.state();
    log(`✓ Connected to StockSmart at ${url}. Trading is ${s.mode === 'live' ? 'LIVE' : 'paper'}${s.halted ? ', stopped' : ''}. Clock difference ${Math.round(s.clockOffset / 1000)} s.`);
    process.exit(0);
  } catch (error) {
    setup(`Could not reach StockSmart: ${error.message}`);
  }
}

log(`StockSmart SNB bot started · ${broker.name ?? 'SNB'} · ${url}`);
if (practice) log('Practice mode: every step of each order runs, and nothing is placed at SNB. Set SNB_BOT_PRACTICE=0 only once the SNB part is built.');
process.on('SIGINT', () => bot.stop('you pressed Ctrl+C'));
const reason = await bot.run();
ledger.close();
// A revoked or wrong key is a setup problem: starting again would not help.
process.exit(reason && /key/.test(reason) ? SETUP_PROBLEM : 0);
