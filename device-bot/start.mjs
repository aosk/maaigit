// Starts the MAAI bot and keeps it running: when the bot updates itself it asks to be started again
// (exit code 75), and after a crash it is started again in 30 seconds. A setup problem (exit code 1) stops here.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UPDATED = 75;
const SETUP_PROBLEM = 1;

let current = null;
// One listener for Ctrl+C, passed to whichever bot is running now.
process.on('SIGINT', () => current?.kill('SIGINT'));

function run() {
  const bot = spawn(process.execPath, [path.join(HERE, 'bot.mjs')], { stdio: 'inherit', env: { ...process.env, MAAI_LAUNCHER: '1' } });
  bot.on('exit', (code) => {
    if (code === UPDATED) {
      console.log('\n↻ Starting the updated bot…\n');
      run();
    } else if (code === SETUP_PROBLEM || code === 0) {
      process.exit(code ?? 0);
    } else {
      console.log(`\n↻ The bot stopped (code ${code}). Starting it again in 30 seconds…\n`);
      setTimeout(run, 30_000);
    }
  });
  current = bot;
}

run();
