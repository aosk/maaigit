import { useEffect, useState } from 'react';
import type { Lang } from '../../shared/types';
import { useSettings } from '../settings';
import { speak, stopSpeaking, voiceChoices } from '../speech';
import { pickVoice, qualityOf, type Quality } from '../voice';
import { Speaker } from './Icons';

const LANGS: Lang[] = ['en', 'ar'];

/** Settings → Reading voice: the best installed voice is used by default; this lets the person choose another and hear it. */
export function VoiceSettings() {
  const { t, settings, update } = useSettings();
  const [voices, setVoices] = useState<Record<Lang, SpeechSynthesisVoice[]>>({ en: [], ar: [] });
  const [playing, setPlaying] = useState<Lang | null>(null);

  useEffect(() => {
    void Promise.all(LANGS.map((l) => voiceChoices(l))).then(([en, ar]) => setVoices({ en, ar }));
    return () => stopSpeaking();
  }, []);

  const label = (v: SpeechSynthesisVoice) => {
    const q: Quality = qualityOf(v);
    const tag = q === 'premium' ? t.voicePremium : q === 'enhanced' ? t.voiceEnhanced : q === 'natural' ? t.voiceNatural : q === 'basic' ? t.voiceBasic : '';
    return tag ? `${v.name} · ${tag}` : v.name;
  };

  const preview = (lang: Lang) => {
    if (playing === lang) {
      stopSpeaking();
      return setPlaying(null);
    }
    setPlaying(lang);
    speak(t.voiceSample[lang], lang, settings.toggles.slow, () => setPlaying(null));
  };

  const hasGood = (lang: Lang) => voices[lang].some((v) => ['premium', 'enhanced', 'natural'].includes(qualityOf(v)));
  const empty = LANGS.every((l) => voices[l].length === 0);

  return (
    <>
      <div className="section-label">{t.voiceTitle}</div>
      <section className="card">
        <p className="sub">{t.voiceHint}</p>
        {empty && <div className="banner">{t.voiceNone}</div>}
        {LANGS.map((lang) => {
          const best = pickVoice(voices[lang], lang);
          const current = pickVoice(voices[lang], lang, settings.voices[lang]);
          return (
            <div key={lang} className="field">
              <label htmlFor={`voice-${lang}`}>{t.voiceFor[lang]}</label>
              <div className="row">
                <select
                  id={`voice-${lang}`}
                  className="grow"
                  value={current?.voiceURI ?? ''}
                  disabled={voices[lang].length === 0}
                  onChange={(e) => update({ voices: { ...settings.voices, [lang]: e.target.value === best?.voiceURI ? undefined : e.target.value } })}
                  style={{ minHeight: 44, borderRadius: 10, border: '1px solid var(--border)', padding: '6px 10px', background: 'var(--surface)', color: 'var(--text)' }}
                >
                  {voices[lang].length === 0 && <option value="">{t.voiceNoneFor}</option>}
                  {voices[lang].map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>{v.voiceURI === best?.voiceURI ? `★ ${label(v)}` : label(v)}</option>
                  ))}
                </select>
                <button type="button" className="btn secondary" onClick={() => preview(lang)} disabled={voices[lang].length === 0} aria-label={`${playing === lang ? t.stop : t.voicePreview}: ${t.voiceFor[lang]}`}>
                  <Speaker size={18} />{playing === lang ? t.stop : t.voicePreview}
                </button>
              </div>
              {voices[lang].length > 0 && !hasGood(lang) && <div className="sub">{t.voiceGetBetter[lang]}</div>}
            </div>
          );
        })}
      </section>
    </>
  );
}
