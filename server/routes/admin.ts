import { Router } from 'express';
import type { AdminOverview, BotOverview } from '../../shared/types.js';
import { botStatus, createKey, revokeKey, setOrderPhone } from '../bot.js';
import { setOrderPin } from '../remote.js';
import { healthReport } from '../health.js';
import { allEvents, audit, state } from '../store.js';
import { status } from '../status.js';
import { recentUsage } from '../usage.js';
import { cloudUsage } from '../anthropic-usage.js';
import { HttpError, find, wrap } from './http.js';

export const admin = Router();

admin.get('/admin', (_req, res) => {
  const approved = state.proposals.filter((p) => p.status === 'approved').length;
  const cancelled = state.proposals.filter((p) => p.status === 'cancelled').length;
  const overview: AdminOverview = {
    counts: {
      events: allEvents().length,
      reminders: state.reminders.length,
      proposals: state.proposals.length,
      approved,
      cancelled,
      drafts: state.drafts,
      chats: state.conversations.reduce((n, c) => n + c.turns.filter((t) => t.role === 'user').length, 0),
    },
    approvalRate: approved + cancelled ? approved / (approved + cancelled) : null,
    agents: state.agents,
    audit: state.audit.slice(0, 50),
    status: status(),
    usage: state.usage,
    usageLog: recentUsage(30),
  };
  res.json(overview);
});

/** What Anthropic reports for the key MAAI uses: rate limits, and tokens and cost when an Admin API key is available. */
admin.get('/admin/cloud', wrap(async (req, res) => res.json(await cloudUsage({ force: req.query.refresh === '1' }))));

admin.patch('/admin/agents/:id', (req, res) => {
  const agent = find(state.agents, req.params.id);
  if (typeof req.body?.enabled !== 'boolean') throw new HttpError(400, 'Say whether to turn it on or off.');
  agent.enabled = req.body.enabled;
  audit(`${agent.name} agent turned ${agent.enabled ? 'on' : 'off'}`, 'Admin', 'done');
  res.json(agent);
});

// ---------- The device bot ----------

const botOverview = (): BotOverview => ({ status: botStatus(), commands: [...state.bot.commands].reverse().slice(0, 30) });

admin.get('/admin/bot', (_req, res) => res.json(botOverview()));

/** A new device key, shown this once. Any older key stops working. */
admin.post('/admin/bot/key', (_req, res) => res.status(201).json({ key: createKey(), ...botOverview() }));

admin.delete('/admin/bot/key', (_req, res) => {
  revokeKey();
  res.json(botOverview());
});

/** How MAAI answers new WhatsApp messages by itself: smart (an AI first reply), fixed (the fixed note), or off. */
admin.patch('/admin/bot/mode', (req, res) => {
  const mode = req.body?.mode;
  if (mode !== 'smart' && mode !== 'fixed' && mode !== 'off') throw new HttpError(400, 'Choose smart, fixed or off.');
  state.replyMode = mode;
  audit(`Automatic WhatsApp replies set to ${mode}`, 'User', 'done');
  res.json(botOverview());
});

/** The user's own second WhatsApp number, whose private messages are orders for the assistant ("" to stop). */
admin.put('/admin/bot/order-phone', (req, res) => {
  try {
    setOrderPhone(req.body?.phone);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  audit(state.bot.orderPhone ? `WhatsApp order number set to +${state.bot.orderPhone}` : 'WhatsApp orders switched off', 'User', 'done');
  res.json(botOverview());
});

/** The PIN for approving cards from the order number on WhatsApp ("" removes it). Only its hash is kept. */
admin.put('/admin/bot/order-pin', (req, res) => {
  try {
    setOrderPin(req.body?.pin);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
  audit(state.bot.orderPin ? 'WhatsApp approval PIN set' : 'WhatsApp approval PIN removed', 'User', 'done');
  res.json(botOverview());
});

/** How every part of MAAI is doing (reads what the server already knows; calls nothing outside). */
admin.get('/admin/health', (_req, res) => res.json(healthReport()));

/** How long a Face ID device stays open without being used before it asks for Face ID again. */
const LOCK_CHOICES = [5, 15, 30, 60, 240, 1440];
admin.put('/security/lock', (req, res) => {
  const minutes = Number(req.body?.minutes);
  if (!LOCK_CHOICES.includes(minutes)) throw new HttpError(400, `Choose one of ${LOCK_CHOICES.join(', ')} minutes.`);
  state.lockMinutes = minutes;
  audit(`Face ID lock set to ${minutes} minutes`, 'User', 'done');
  res.json({ minutes });
});
