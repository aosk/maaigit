import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContactCount } from '../../shared/types';
import { DEFAULT_FILTER, filterCards, parseVcards, type AddressCard, type CardFilter } from '../../shared/vcard';
import { api } from '../api';
import { dayTime } from '../format';
import { useSettings } from '../settings';
import { useAction } from '../useAction';

/** How many rows the review list shows at once; searching finds the rest. */
const SHOWN = 150;

type Draft = AddressCard & { index: number };

/** Settings → Contacts: import a contacts file (iCloud, Google, a phone) so the assistant can find people by name. */
export function ContactsImport() {
  const { t, settings } = useSettings();
  const [count, setCount] = useState<ContactCount | null>(null);
  const [note, setNote] = useState('');
  // The file read on this device, waiting for the user to check it; nothing is sent until they import.
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, error, setError, run } = useAction();

  useEffect(() => {
    api.contacts().then(setCount).catch(() => {});
  }, []);

  const readFile = (file: File | undefined) =>
    run(async () => {
      if (!file) return;
      setNote('');
      // Read here, on the device: only names, numbers, emails and companies are kept (no photos or notes).
      const cards = parseVcards(await file.text());
      if (fileRef.current) fileRef.current.value = '';
      if (!cards.length) {
        setError(t.contactsNoneInFile);
        return;
      }
      setDraft(cards.map((c, index) => ({ ...c, index })));
    });

  const send = (cards: AddressCard[]) =>
    run(async () => {
      const now = await api.importContacts(cards.map(({ name, phones, emails, org }) => ({ name, phones, emails, ...(org ? { org } : {}) })));
      setCount(now);
      setNote(t.contactsImported(now.imported));
      setDraft(null);
    });

  const remove = () =>
    run(async () => {
      if (!window.confirm(t.contactsRemoveConfirm)) return;
      setCount(await api.clearContacts());
      setNote('');
    });

  return (
    <>
      <div className="section-label">{t.contactsTitle}</div>
      <section className="card" aria-label={t.contactsTitle}>
        {draft ? (
          <Review cards={draft} busy={busy} onImport={send} onCancel={() => setDraft(null)} />
        ) : (
          <>
            <p className="sub">
              {count ? t.contactsNow(count.imported, count.fromWhatsApp) : '…'}
              {count?.importedAt ? ` · ${t.contactsLast(dayTime(count.importedAt, settings.lang))}` : ''}
            </p>
            <input ref={fileRef} type="file" accept=".vcf,text/vcard,text/x-vcard" hidden onChange={(e) => void readFile(e.target.files?.[0])} />
            <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? t.contactsReading : count?.imported ? t.contactsReimport : t.contactsImport}</button>
            <details>
              <summary className="sub">{t.contactsHowTitle}</summary>
              <ol className="sub" style={{ margin: '6px 0 0', paddingInlineStart: 20 }}>
                {t.contactsHow.map((step) => <li key={step}>{step}</li>)}
              </ol>
            </details>
            <p className="sub">{t.contactsPrivacy}</p>
          </>
        )}
        {note && <p className="sub" role="status">✓ {note}</p>}
        {error && <div className="error" role="alert">{error}</div>}
        {!draft && Boolean(count?.imported) && <button className="btn ghost" onClick={remove} disabled={busy}>{t.contactsRemove}</button>}
      </section>
    </>
  );
}

/** The file's contacts before they are sent: filters for the whole list, and a tick on each person to leave someone out. */
function Review({ cards, busy, onImport, onCancel }: { cards: Draft[]; busy: boolean; onImport: (cards: AddressCard[]) => void; onCancel: () => void }) {
  const { t, settings } = useSettings();
  const [filter, setFilter] = useState<CardFilter>(DEFAULT_FILTER);
  const [unticked, setUnticked] = useState<Set<number>>(() => new Set());
  const [query, setQuery] = useState('');

  const kept = useMemo(() => filterCards(cards.filter((c) => !unticked.has(c.index)), filter), [cards, unticked, filter]);
  const keptByIndex = useMemo(() => new Map(kept.map((c) => [c.index, c])), [kept]);
  // Unticked people stay in the list (to tick again); those a filter left out show why.
  const passing = useMemo(() => new Set(filterCards(cards, filter).map((c) => c.index)), [cards, filter]);
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const matching = cards.filter((c) => !q || c.name.toLowerCase().includes(q) || (digits.length >= 3 && c.phones.some((p) => p.includes(digits))) || c.emails.some((e) => e.includes(q)));
  const num = (x: number) => x.toLocaleString(settings.lang === 'ar' ? 'ar-SA' : 'en-GB');

  function toggle(index: number) {
    setUnticked((now) => {
      const next = new Set(now);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="contacts-review">
      <h3 className="h2" style={{ fontSize: '1.05em' }}>{t.contactsReview}</h3>
      <p className="sub" role="status">
        {t.contactsInFile(cards.length, kept.length)}
        {unticked.size > 0 && ` · ${t.contactsUnticked(unticked.size)}`}
      </p>

      <fieldset className="contacts-filters">
        {(Object.keys(DEFAULT_FILTER) as (keyof CardFilter)[]).map((key) => (
          <label key={key} className="check-label">
            <input type="checkbox" checked={filter[key]} onChange={(e) => setFilter({ ...filter, [key]: e.target.checked })} />
            {t.contactsFilters[key]}
          </label>
        ))}
      </fieldset>

      <div className="search">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.contactsSearch} aria-label={t.contactsSearch} dir="auto" />
      </div>

      <ul className="contacts-list">
        {matching.slice(0, SHOWN).map((c) => {
          const filteredOut = !passing.has(c.index);
          const shown = keptByIndex.get(c.index) ?? c;
          return (
            <li key={c.index}>
              <label className={`check-label${filteredOut ? ' muted' : ''}`}>
                <input type="checkbox" checked={keptByIndex.has(c.index)} disabled={filteredOut} onChange={() => toggle(c.index)} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <bdi className="contact-name">{c.name}</bdi>
                  <span className="sub" style={{ display: 'block' }}>
                    {filteredOut ? t.contactsFilteredOut : <bdi dir="ltr">{shown.phones[0] ? `+${shown.phones[0]}` : shown.emails[0] ?? ''}</bdi>}
                    {!filteredOut && shown.phones.length > 1 && ` · +${num(shown.phones.length - 1)}`}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {matching.length > SHOWN && <p className="sub">{t.contactsShownOf(SHOWN, matching.length)}</p>}

      <div className="row wrap">
        <button className="btn primary" onClick={() => onImport(kept)} disabled={busy || kept.length === 0}>{busy ? t.sending : t.contactsImportN(kept.length)}</button>
        <button className="btn ghost" onClick={onCancel} disabled={busy}>{t.cancel}</button>
      </div>
    </div>
  );
}
