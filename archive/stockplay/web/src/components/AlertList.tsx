import type { Alert } from '../../../shared/src/types.js';
import { clockTime } from '../lib/format.js';

/** Status is never color alone: each row carries an icon and the kind in
 *  words alongside the tinted label. */
const ICON: Record<Alert['severity'], string> = {
  good: '▲',
  warning: '!',
  serious: '!',
  critical: '✕',
};

const KIND_LABEL: Record<Alert['kind'], string> = {
  MOVE: 'Price move',
  STOP_LOSS: 'Stop loss',
  ALLOCATION: 'Allocation drift',
  POSITION_LIMIT: 'Position limit',
};

export function AlertList({
  alerts,
  onAck,
  emptyMessage,
}: {
  alerts: Alert[];
  onAck?: (id: string) => void;
  emptyMessage: string;
}) {
  if (alerts.length === 0) {
    return <div className="empty">{emptyMessage}</div>;
  }

  return (
    <ul className="alert-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {alerts.map((alert) => (
        <li key={alert.id} className={`alert alert-${alert.severity}${alert.acknowledged ? ' is-ack' : ''}`}>
          <span className="alert-icon" aria-hidden="true">
            {ICON[alert.severity]}
          </span>
          <div className="alert-body">
            <div className="alert-kind">{KIND_LABEL[alert.kind]}</div>
            <div className="alert-msg">{alert.message}</div>
            <div className="alert-time">{clockTime(alert.createdAt)}</div>
          </div>
          {onAck && !alert.acknowledged ? (
            <button
              type="button"
              className="btn btn-sm alert-ack"
              onClick={() => onAck(alert.id)}
              aria-label={`Acknowledge: ${alert.message}`}
            >
              Ack
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
