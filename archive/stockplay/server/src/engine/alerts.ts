import {
  ASSET_TYPE_PROFILES,
  type Alert,
  type AlertKind,
  type PortfolioSnapshot,
} from '../../../shared/src/types.js';
import type { AppState } from '../store/state.js';
import { MAX_ALERTS } from '../store/state.js';

/** How far a type may drift from its target weight before it is flagged. */
export const ALLOCATION_DRIFT_TOLERANCE = 0.1;

function key(kind: AlertKind, scope: string): string {
  return `${kind}:${scope}`;
}

/**
 * Raises alerts for anything the control page's thresholds say is out of line.
 * An alert is only raised when no unacknowledged alert with the same kind and
 * scope is already open, so a persistent breach does not flood the feed.
 */
export function evaluateAlerts(state: AppState, snap: PortfolioSnapshot): Alert[] {
  const open = new Set(
    state.alerts
      .filter((a) => !a.acknowledged)
      .map((a) => key(a.kind, a.instrumentId ?? a.type)),
  );
  const raised: Alert[] = [];
  const now = new Date(state.simTime).toISOString();

  const push = (alert: Omit<Alert, 'id' | 'createdAt' | 'acknowledged'>) => {
    const scope = alert.instrumentId ?? alert.type;
    if (open.has(key(alert.kind, scope))) return;
    open.add(key(alert.kind, scope));
    raised.push({
      ...alert,
      id: `alr_${state.simTime.toString(36)}_${raised.length}_${scope}`,
      createdAt: now,
      acknowledged: false,
    });
  };

  for (const holding of snap.holdings) {
    const controls = state.controls[holding.type];

    if (controls.moveAlertPct > 0 && Math.abs(holding.dayChangePct) >= controls.moveAlertPct) {
      const up = holding.dayChangePct > 0;
      push({
        kind: 'MOVE',
        severity: up ? 'good' : 'warning',
        type: holding.type,
        instrumentId: holding.instrumentId,
        symbol: holding.symbol,
        message: `${holding.symbol} moved ${(holding.dayChangePct * 100).toFixed(1)}% today, past the ${(controls.moveAlertPct * 100).toFixed(1)}% day-move threshold for ${ASSET_TYPE_PROFILES[holding.type].label}.`,
      });
    }

    if (controls.stopLossPct > 0 && holding.unrealizedPnLPct <= -controls.stopLossPct) {
      push({
        kind: 'STOP_LOSS',
        severity: 'critical',
        type: holding.type,
        instrumentId: holding.instrumentId,
        symbol: holding.symbol,
        message: `${holding.symbol} is ${(Math.abs(holding.unrealizedPnLPct) * 100).toFixed(1)}% below average cost, past its ${(controls.stopLossPct * 100).toFixed(0)}% stop-loss.`,
      });
    }

    if (controls.maxPositionPct > 0 && holding.weight > controls.maxPositionPct) {
      push({
        kind: 'POSITION_LIMIT',
        severity: 'serious',
        type: holding.type,
        instrumentId: holding.instrumentId,
        symbol: holding.symbol,
        message: `${holding.symbol} is ${(holding.weight * 100).toFixed(1)}% of the portfolio, over its ${(controls.maxPositionPct * 100).toFixed(0)}% cap.`,
      });
    }
  }

  for (const row of snap.byType) {
    if (Math.abs(row.drift) <= ALLOCATION_DRIFT_TOLERANCE) continue;
    const over = row.drift > 0;
    push({
      kind: 'ALLOCATION',
      severity: 'warning',
      type: row.type,
      message: `${ASSET_TYPE_PROFILES[row.type].label} is ${(row.weight * 100).toFixed(1)}% of invested value against a ${(row.targetAllocation * 100).toFixed(0)}% target — ${(Math.abs(row.drift) * 100).toFixed(1)}pp ${over ? 'over' : 'under'}.`,
    });
  }

  if (raised.length) {
    state.alerts.unshift(...raised);
    if (state.alerts.length > MAX_ALERTS) state.alerts.length = MAX_ALERTS;
  }
  return raised;
}
