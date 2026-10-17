import type { StatusInfo } from '../shared/types.js';
import { MODEL, client } from './ai/claude.js';
import { mailConfigured, mailFrom } from './mail.js';
import { inboxConfigured } from './gmail-inbox.js';
import { calendarStatus } from './gcal.js';
import { asanaStatus } from './asana.js';
import { googleWriteStatus } from './gwrite.js';
import { whatsappStatus } from './whatsapp.js';
import { newsStatus } from './news/index.js';
import { config } from './config.js';
import { dataIsPersistent } from './storage.js';

/** What is connected, for Settings → Connections and the admin portal. */
export function status(): StatusInfo {
  return {
    aiConfigured: Boolean(client),
    mail: { configured: mailConfigured, from: mailFrom, inbox: inboxConfigured },
    calendar: { ...calendarStatus(), write: googleWriteStatus() },
    asana: asanaStatus(),
    whatsapp: whatsappStatus(),
    news: newsStatus(),
    // Only online: on a computer at home the data folder is the computer's own disk.
    storage: config.production ? { persistent: dataIsPersistent(config.dataDir), dir: config.dataDir } : undefined,
    model: MODEL,
    location: { latitude: config.latitude, longitude: config.longitude, timezone: config.timezone },
  };
}
