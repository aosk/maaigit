import { Router } from 'express';
import type { AdminOverview } from '../../shared/types.js';
import { allEvents, audit, state } from '../store.js';
import { status } from '../status.js';
import { recentUsage } from '../usage.js';
import { find } from './http.js';

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

admin.patch('/admin/agents/:id', (req, res) => {
  const agent = find(state.agents, req.params.id);
  agent.enabled = Boolean(req.body.enabled);
  audit(`${agent.name} agent turned ${agent.enabled ? 'on' : 'off'}`, 'Admin', 'done');
  res.json(agent);
});
