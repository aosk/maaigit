import { useEffect, useState } from 'react';
import type { ExchangeLine, SentMessage } from '../../shared/types';
import { api } from '../api';
import { dayHeading, time } from '../format';
import { stripBidi } from '../links';
import { useOnRefresh } from '../refresh';
import { useSettings } from '../settings';
import { Back } from './Icons';

type Kind = SentMessage['kind'];
const KINDS: ('all' | Kind)[] = ['all', 'reply', 'approved', 'team', 'courier', 'self'];

/** A WhatsApp conversation in order: what they wrote on one side, what went out to them on the other, each marked. */
export function Exchange({ lines }: { lines: ExchangeLine[] }) {
  const { t, settings } = useSettings();
  return (
    <ol className="exchange" aria-label={t.sent.conversation}>
      {lines.map((line, i) => (
        <li key={i} className={`ex ${line.who}${line.status === 'failed' || line.status === 'expired' ? ' failed' : ''}`}>
          {line.who === 'sent' && (
            <span className="ex-mark">
              {t.sent.kind[line.kind ?? 'reply']}
              {line.status && line.status !== 'done' ? ` · ${t.sent.status[line.status]}` : ''}
            </span>
          )}
          <span className="ex-text" dir="auto">{line.text}</span>
          <span className="ex-time">{time(line.at, settings.lang)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Everything that went out on WhatsApp through MAAI, newest first, to look back at what was said and to whom. */
export function SentMessages({ onBack }: { onBack: () => void }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const [messages, setMessages] = useState<SentMessage[] | null>(null);
  const [error, setError] = useState('');
  const [kind, setKind] = useState<'all' | Kind>('all');
  const load = () => {
    api.sent().then((r) => { setMessages(r.messages); setError(''); }).catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);
  useOnRefresh(load);

  const shown = (messages ?? []).filter((m) => kind === 'all' || m.kind === kind);
  return (
    <div className="screen cols">
      <button className="btn ghost" onClick={onBack} style={{ paddingInline: 0, alignSelf: 'flex-start' }}><Back size={20} />{t.sent.back}</button>
      <h1 className="title">{t.sent.title}</h1>
      <p className="sub">{t.sent.note}</p>
      <div className="seg wrap" role="radiogroup" aria-label={t.sent.filter}>
        {KINDS.map((k) => (
          <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>{k === 'all' ? t.sent.all : t.sent.kind[k]}</button>
        ))}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {!messages && !error && <div className="skeleton" aria-label={t.loading}><span /><span /><span /></div>}
      {messages && shown.length === 0 && <p className="sub">{t.sent.none}</p>}
      <ul className="sent-list">
        {shown.map((m) => (
          <li key={m.id} className={`card sent-item${m.status === 'failed' || m.status === 'expired' ? ' failed' : ''}`}>
            <div className="between wrap">
              <strong><bdi>{stripBidi(m.toName || `+${m.phone}`)}</bdi> <bdi dir="ltr" className="sub">+{m.phone}</bdi></strong>
              <span className="sub">{dayHeading(m.at, lang)} {time(m.at, lang)}</span>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="tag">{t.sent.kind[m.kind]}</span>
              <span className={`tag${m.status === 'done' ? '' : m.status === 'failed' || m.status === 'expired' ? ' urgent' : ' maybe'}`}>{t.sent.status[m.status]}</span>
              {m.withPicture && <span className="tag">{t.sent.withPicture}</span>}
            </div>
            <p className="sent-text" dir="auto">{m.text}</p>
            {m.problem && <p className="error" dir="auto">{m.problem}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
