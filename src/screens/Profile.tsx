import { useEffect, useState, type FormEvent } from 'react';
import type { ProfileCategory, ProfileFact, ProfileInfo } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { useAction } from '../useAction';
import { Back, Trash } from '../components/Icons';

const CATEGORIES: ProfileCategory[] = ['preference', 'person', 'routine', 'work', 'other'];

/** Settings → What MAAI knows about me: every fact MAAI keeps, with the controls to add, edit, pin, delete, pause and wipe them. */
export function ProfileScreen() {
  const { t } = useSettings();
  const [info, setInfo] = useState<ProfileInfo | null>(null);
  const [text, setText] = useState('');
  const [category, setCategory] = useState<ProfileCategory>('preference');
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction();

  const load = () => api.profile().then(setInfo);
  useEffect(() => {
    void load().catch(() => {});
  }, []);

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    void run(async () => {
      await api.addFact(text, category);
      setText('');
      await load();
    });
  };

  const facts = info?.facts ?? [];

  return (
    <div className="screen cols">
      <a href="#/settings" className="btn ghost back-link"><Back size={18} />{t.settings}</a>
      <h1 className="title">{t.profileTitle}</h1>
      <p className="sub">{t.profileIntro}</p>

      <section className="card flush">
        <div className="toggle-row">
          <div>
            <div>{t.profileUse}</div>
            <div className="sub">{t.profileUseHint}</div>
          </div>
          <button role="switch" className="switch" aria-checked={info?.enabled ?? true} aria-label={t.profileUse} disabled={!info} onClick={() => info && void run(async () => setInfo(await api.useProfile(!info.enabled)))}>
            <span />
          </button>
        </div>
      </section>

      <form className="card" onSubmit={add}>
        <div className="field">
          <label htmlFor="fact-text">{t.profileAddLabel}</label>
          <input id="fact-text" value={text} maxLength={200} placeholder={t.profilePlaceholder} autoComplete="off" onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="row">
          <div className="field grow">
            <label htmlFor="fact-cat">{t.profileCategoryLabel}</label>
            <select id="fact-cat" value={category} onChange={(e) => setCategory(e.target.value as ProfileCategory)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t.profileCategory[c]}</option>)}
            </select>
          </div>
          <button type="submit" className="btn primary big" disabled={busy || !text.trim()} style={{ alignSelf: 'flex-end' }}>{t.profileAdd}</button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}
      </form>

      {info && (
        <p className="sub" role="status">{t.profileCount(facts.length, info.limits.maxFacts)}</p>
      )}
      {info && facts.length === 0 && <p className="card sub">{t.profileEmpty}</p>}

      {CATEGORIES.map((c) => {
        const inGroup = facts.filter((f) => f.category === c);
        if (!inGroup.length) return null;
        return (
          <div key={c}>
            <h2 className="section-label">{t.profileCategory[c]}</h2>
            <section className="card flush">
              {inGroup.map((f) => <Fact key={f.id} fact={f} onChanged={load} />)}
            </section>
          </div>
        );
      })}

      {facts.length > 0 && (
        <div className="row wrap">
          <a className="btn secondary grow" href="/api/profile/export" download="maai-profile.json" style={{ textDecoration: 'none' }}>{t.profileExport}</a>
          {confirming ? (
            <button className="btn danger grow" disabled={busy} onClick={() => void run(async () => { await api.forgetProfile(); setConfirming(false); await load(); })}>{t.profileForgetYes}</button>
          ) : (
            <button className="btn danger grow" onClick={() => setConfirming(true)}>{t.profileForgetAll}</button>
          )}
        </div>
      )}
      {confirming && <div className="banner" role="alert">{t.profileForgetConfirm(facts.length)}</div>}
      <p className="sub">{t.profileFooter}</p>
    </div>
  );
}

function Fact({ fact, onChanged }: { fact: ProfileFact; onChanged: () => Promise<unknown> }) {
  const { t } = useSettings();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(fact.text);
  const { busy, error, run } = useAction();

  const save = () => run(async () => {
    await api.updateFact(fact.id, { text });
    setEditing(false);
    await onChanged();
  });

  return (
    <div className="fact">
      {editing ? (
        <div className="field">
          <label htmlFor={`edit-${fact.id}`} className="sr-only">{t.profileEdit}</label>
          <input id={`edit-${fact.id}`} value={text} maxLength={200} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="row">
            <button className="btn primary grow" disabled={busy || !text.trim()} onClick={() => void save()}>{t.profileSave}</button>
            <button className="btn secondary grow" onClick={() => { setText(fact.text); setEditing(false); }}>{t.cancel}</button>
          </div>
        </div>
      ) : (
        <>
          <div className="fact-text">{fact.text}</div>
          <div className="sub">{t.profileFrom[fact.source]} · {t.profileUses(fact.uses)}{fact.pinned ? ` · ${t.profilePinned}` : ''}</div>
          <div className="row wrap fact-actions">
            <button className="btn ghost" onClick={() => setEditing(true)}>{t.profileEdit}</button>
            <button className="btn ghost" role="switch" aria-checked={Boolean(fact.pinned)} onClick={() => void run(async () => { await api.updateFact(fact.id, { pinned: !fact.pinned }); await onChanged(); })}>{t.profilePin}</button>
            <button className="icon-btn" aria-label={t.profileDelete(fact.text)} disabled={busy} onClick={() => void run(async () => { await api.deleteFact(fact.id); await onChanged(); })}><Trash size={20} /></button>
          </div>
        </>
      )}
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}
