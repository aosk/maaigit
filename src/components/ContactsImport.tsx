import { useEffect, useRef, useState } from 'react';
import type { ContactCount } from '../../shared/types';
import { parseVcards } from '../../shared/vcard';
import { api } from '../api';
import { dayTime } from '../format';
import { useSettings } from '../settings';
import { useAction } from '../useAction';

/** Settings → Contacts: import a contacts file (iCloud, Google, a phone) so the assistant can find people by name. */
export function ContactsImport() {
  const { t, settings } = useSettings();
  const [count, setCount] = useState<ContactCount | null>(null);
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, error, setError, run } = useAction();

  useEffect(() => {
    api.contacts().then(setCount).catch(() => {});
  }, []);

  const importFile = (file: File | undefined) =>
    run(async () => {
      if (!file) return;
      setNote('');
      // Read here, on the device: only names, numbers, emails and companies are sent (no photos or notes).
      const cards = parseVcards(await file.text());
      if (!cards.length) {
        setError(t.contactsNoneInFile);
        return;
      }
      const now = await api.importContacts(cards);
      setCount(now);
      setNote(t.contactsImported(now.imported));
      if (fileRef.current) fileRef.current.value = '';
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
        <p className="sub">
          {count ? t.contactsNow(count.imported, count.fromWhatsApp) : '…'}
          {count?.importedAt ? ` · ${t.contactsLast(dayTime(count.importedAt, settings.lang))}` : ''}
        </p>
        <input ref={fileRef} type="file" accept=".vcf,text/vcard,text/x-vcard" hidden onChange={(e) => void importFile(e.target.files?.[0])} />
        <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? t.contactsReading : count?.imported ? t.contactsReimport : t.contactsImport}</button>
        <details>
          <summary className="sub">{t.contactsHowTitle}</summary>
          <ol className="sub" style={{ margin: '6px 0 0', paddingInlineStart: 20 }}>
            {t.contactsHow.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </details>
        <p className="sub">{t.contactsPrivacy}</p>
        {note && <p className="sub" role="status">✓ {note}</p>}
        {error && <div className="error" role="alert">{error}</div>}
        {Boolean(count?.imported) && <button className="btn ghost" onClick={remove} disabled={busy}>{t.contactsRemove}</button>}
      </section>
    </>
  );
}
