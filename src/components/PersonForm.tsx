import { useEffect, useRef, useState } from 'react';
import type { Team, TeamMember } from '../../shared/types';
import type { AddressCard } from '../../shared/vcard';
import { api } from '../api';
import { useSettings } from '../settings';
import { langChoice, langOk, memberLang, phoneOk, plusDigits } from '../teamsLogic';
import { useAction } from '../useAction';

/** Adds a person (found in the contacts, or typed) to teams, or, with `person`, changes their teams and language. */
export function PersonForm({ teams, person, onSaved, onCancel }: { teams: Team[]; person?: TeamMember; onSaved: () => Promise<void>; onCancel?: () => void }) {
  const { t } = useSettings();
  const editing = Boolean(person);
  const [name, setName] = useState(person?.name ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [teamIds, setTeamIds] = useState<string[]>(person?.teamIds ?? []);
  const [choice, setChoice] = useState(langChoice(person?.lang ?? 'ar'));
  const [other, setOther] = useState(person && langChoice(person.lang) === 'other' ? person.lang : '');
  const { busy, error, setError, run } = useAction();
  const uid = person?.phone ?? 'new';

  const toggleTeam = (id: string) => setTeamIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const save = () =>
    run(async () => {
      if (!name.trim()) return setError(t.tm.errName);
      if (!phoneOk(phone)) return setError(t.tm.errPhone);
      if (!teamIds.length) return setError(t.tm.errTeam);
      if (choice === 'other' && !langOk(other)) return setError(t.tm.errLang);
      await api.saveMember({ phone, name, teamIds, lang: memberLang(choice, other) });
      if (!editing) {
        setName('');
        setPhone('');
        setTeamIds([]);
        setChoice('ar');
        setOther('');
      }
      await onSaved();
    });

  const langs = [['ar', t.tm.langAr], ['en', t.tm.langEn], ['other', t.tm.langOther]] as const;

  return (
    <form className="tm-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {!editing && (
        <>
          <ContactSearch onPick={(n, p) => { setName(n); setPhone(p); setError(''); }} />
          <span className="sub">{t.tm.orType}</span>
        </>
      )}
      {editing ? (
        <p><strong><bdi>{person?.name}</bdi></strong> <bdi dir="ltr" className="sub">{plusDigits(person?.phone ?? '')}</bdi></p>
      ) : (
        <>
          <div className="field">
            <label htmlFor={`tm-pname-${uid}`}>{t.tm.personName}</label>
            <input id={`tm-pname-${uid}`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`tm-pphone-${uid}`}>{t.tm.personPhone}</label>
            <input id={`tm-pphone-${uid}`} value={phone} dir="ltr" inputMode="tel" autoComplete="off" onChange={(e) => setPhone(e.target.value)} aria-describedby={`tm-pphone-hint-${uid}`} />
            <span className="sub" id={`tm-pphone-hint-${uid}`}>{t.tm.phoneHint}</span>
          </div>
        </>
      )}
      <fieldset className="tm-fieldset">
        <legend className="section-label">{t.tm.teamsFollowed}</legend>
        {teams.map((team) => (
          <label key={team.id} className="tm-check">
            <input type="checkbox" checked={teamIds.includes(team.id)} onChange={() => toggleTeam(team.id)} />
            <bdi>{team.name}</bdi>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <span className="section-label" id={`tm-lang-${uid}`} style={{ padding: 0 }}>{t.tm.language}</span>
        <div className="seg" role="radiogroup" aria-labelledby={`tm-lang-${uid}`}>
          {langs.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={choice === id} onClick={() => setChoice(id)}>{label}</button>
          ))}
        </div>
        {choice === 'other' && (
          <>
            <label htmlFor={`tm-lother-${uid}`} className="sub">{t.tm.langOtherLabel}</label>
            <input id={`tm-lother-${uid}`} value={other} maxLength={8} dir="ltr" autoCapitalize="none" onChange={(e) => setOther(e.target.value)} />
          </>
        )}
      </div>
      <div className="row wrap">
        <button className="btn primary" type="submit" disabled={busy}>{editing ? t.tm.save : t.tm.addPerson}</button>
        {onCancel && <button className="btn ghost" type="button" onClick={onCancel}>{t.tm.cancel}</button>}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
    </form>
  );
}

/** Looks the owner's contacts up while they type (after a short pause); a card with several numbers asks which one. */
function ContactSearch({ onPick }: { onPick: (name: string, phone: string) => void }) {
  const { t } = useSettings();
  const [q, setQ] = useState('');
  const [cards, setCards] = useState<AddressCard[] | null>(null);
  const [open, setOpen] = useState<AddressCard | null>(null);
  const [failed, setFailed] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    const mine = ++seq.current;
    if (!query) return;
    const timer = setTimeout(() => {
      api.teamContacts(query).then(
        (found) => {
          if (mine !== seq.current) return;
          setFailed('');
          setCards(found);
        },
        (e: Error) => {
          if (mine === seq.current) setFailed(e.message);
        },
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const choose = (card: AddressCard, phone: string) => {
    onPick(card.name, phone);
    setOpen(null);
    setCards(null);
    setQ('');
  };

  return (
    <div className="field">
      <label htmlFor="tm-search">{t.tm.searchContacts}</label>
      <input id="tm-search" type="search" value={q} placeholder={t.tm.searchHint} autoComplete="off" onChange={(e) => { setQ(e.target.value); setOpen(null); if (!e.target.value.trim()) setCards(null); }} />
      {failed && <div className="error" role="alert">{failed}</div>}
      {cards && cards.length === 0 && !failed && <p className="sub" role="status">{t.tm.noMatches}</p>}
      {cards && cards.length > 0 && (
        <ul className="tm-list" aria-label={t.tm.searchContacts}>
          {cards.map((card, i) => (
            <li key={`${card.name}-${i}`} className="tm-item">
              <button
                type="button"
                className="tm-result"
                aria-expanded={card.phones.length > 1 ? open === card : undefined}
                disabled={card.phones.length === 0}
                onClick={() => (card.phones.length === 1 && card.phones[0] ? choose(card, card.phones[0]) : setOpen(open === card ? null : card))}
              >
                <strong><bdi>{card.name}</bdi></strong>
                {card.org && <span className="sub"><bdi>{card.org}</bdi></span>}
                {card.phones.length === 1 && <bdi dir="ltr" className="sub">{plusDigits(card.phones[0] ?? '')}</bdi>}
              </button>
              {open === card && card.phones.length > 1 && (
                <div role="group" aria-label={t.tm.pickNumber} className="tm-numbers">
                  <span className="sub">{t.tm.pickNumber}</span>
                  {card.phones.map((p) => (
                    <button key={p} type="button" className="btn secondary" onClick={() => choose(card, p)}>
                      <bdi dir="ltr">{plusDigits(p)}</bdi>
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
