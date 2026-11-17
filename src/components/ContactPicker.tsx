import { useEffect, useRef, useState } from 'react';
import type { AddressCard } from '../../shared/vcard';
import { api } from '../api';
import { canPickContacts, pickContacts } from '../contacts';
import { stripBidi } from '../links';
import { useSettings } from '../settings';

/** "Name (+9665…)" as it is dropped into a message to the assistant. */
export const contactText = (name: string, phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  return digits ? `${name.trim() || `+${digits}`} (+${digits})` : name.trim();
};

/**
 * Picks someone from the contacts MAAI already holds (the ones the phone shared, and imported cards), by typing part
 * of the name. Works on the iPhone too, where the browser has no contact picker of its own.
 */
export function ContactPicker({ onPick, onClose }: { onPick: (text: string) => void; onClose: () => void }) {
  const { t } = useSettings();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ q: string; cards: AddressCard[] } | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [tel, setTel] = useState('');
  const box = useRef<HTMLInputElement>(null);
  const addTyped = () => {
    const text = contactText(name, tel);
    if (tel.replace(/\D/g, '').length >= 8 && text) onPick(text);
  };
  // What was found, with the words it was found for: results for an older search are never shown under a newer one.
  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) return;
    let current = true;
    // A short pause, so a search is not sent for every letter.
    const timer = setTimeout(() => {
      api.teamContacts(q).then((cards) => { if (current) { setFound({ q, cards }); setError(''); } }).catch((e: Error) => { if (current) setError(e.message); });
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [q]);
  const cards = q.length >= 2 && found?.q === q ? found.cards : null;

  return (
    <div className="contact-picker card" role="dialog" aria-label={t.cp.title}>
      <div className="between">
        <strong>{t.cp.title}</strong>
        <button type="button" className="btn ghost" onClick={onClose}>{t.cp.close}</button>
      </div>
      {canPickContacts() && (
        // The phone's own contact list, where the browser offers it (Android; on the iPhone only with Safari's "Contact Picker API" switched on).
        <button type="button" className="btn primary" onClick={() => void pickContacts().then((names) => names && onPick(names)).catch(() => {})}>{t.cp.fromPhone}</button>
      )}
      {/* On the iPhone the keyboard offers "AutoFill Contact" for a name and a phone field: any contact on the phone can be chosen there. */}
      {/* Not a form of its own: it sits inside the message form, and a form inside a form would send the message instead. */}
      <div className="cp-phone">
        <span className="sub">{t.cp.autofillHint}</span>
        <div className="row">
          <input className="grow" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.cp.name} aria-label={t.cp.name} dir="auto" />
          <input className="grow" name="tel" type="tel" inputMode="tel" autoComplete="tel" value={tel} onChange={(e) => setTel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }} placeholder={t.cp.tel} aria-label={t.cp.tel} dir="ltr" />
          <button type="button" className="btn secondary" disabled={tel.replace(/\D/g, '').length < 8} onClick={addTyped}>{t.cp.add}</button>
        </div>
      </div>
      <span className="sub">{t.cp.orSearch}</span>
      <input ref={box} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.cp.search} aria-label={t.cp.search} dir="auto" autoComplete="off" />
      {error && <div className="error" role="alert">{error}</div>}
      {cards && cards.length === 0 && <p className="sub">{t.cp.none}</p>}
      {!cards && !error && <p className="sub">{t.cp.hint}</p>}
      <ul className="cp-list">
        {(cards ?? []).flatMap((card) =>
          card.phones.slice(0, 3).map((phone) => (
            <li key={`${card.name}:${phone}`}>
              <button type="button" onClick={() => onPick(contactText(card.name, phone))}>
                <span><bdi>{stripBidi(card.name)}</bdi>{card.org ? <span className="sub"> · <bdi>{stripBidi(card.org)}</bdi></span> : null}</span>
                <bdi dir="ltr" className="sub">{phone}</bdi>
              </button>
            </li>
          )),
        )}
      </ul>

    </div>
  );
}
