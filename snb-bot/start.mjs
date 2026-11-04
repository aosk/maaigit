// Keeps the bot running: after a crash it starts again in 30 seconds. A setup problem (exit code 1) stops here.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let current = null;
process.on('SIGINT', () => current?.kill('SIGINT'));

function run() {
  const bot = spawn(process.execPath, [path.join(HERE, 'bot.mjs')], { stdio: 'inherit' });
  bot.on('exit', (code) => {
    if (code === 1 || code === 0) process.exit(code ?? 0);
    console.log(`\n↻ The bot stopped (code ${code}). Starting it again in 30 seconds…\n`);
    setTimeout(run, 30_000);
  });
  current = bot;
}

run();
