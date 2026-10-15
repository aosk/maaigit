import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '../shared/types';
import { strings, type Strings } from './i18n';
import { setChosenVoices } from './speech';
import { detectLayout, effectiveLayout, type Layout, type LayoutChoice } from './layout';

export type Look = 'system' | 'light' | 'dark';
export type ToggleId = keyof Strings['toggles'];

interface Settings {
  lang: Lang;
  look: Look;
  /** Which screen type to lay MAAI out for: automatic (from the window's width) or one chosen here. */
  layout: LayoutChoice;
  toggles: Record<ToggleId, boolean>;
  /** Play MAAI's chime when an alert arrives while the app is open. */
  sound: boolean;
  /** The voice picked for reading aloud, per language (by the phone's voice id); empty means the best one installed. */
  voices: Partial<Record<Lang, string>>;
}

const DEFAULTS: Settings = {
  lang: 'en',
  look: 'system',
  layout: 'auto',
  sound: true,
  voices: {},
  toggles: { longListen: false, simple: false, captions: true, speakReplies: false, slow: false, largeText: false, contrast: false, reduceMotion: false },
};

const KEY = 'maai.settings';

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULTS, ...saved, toggles: { ...DEFAULTS.toggles, ...saved.toggles } };
  } catch {
    return DEFAULTS;
  }
}

interface Ctx {
  settings: Settings;
  t: Strings;
  /** The screen type in use, and the one the window's width suggests (they differ when one is chosen by hand). */
  layout: Layout;
  detected: Layout;
  width: number;
  update: (patch: Partial<Settings>) => void;
  toggle: (id: ToggleId) => void;
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);
  const [width, setWidth] = useState(() => window.innerWidth);

  // A fold opening, a tablet turning or a resized window all change the width.
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth(window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame);
    };
  }, []);
  const layout = effectiveLayout(settings.layout, width);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // Private windows can refuse storage; settings then last for this visit only.
    }
    setChosenVoices(settings.voices);
    const root = document.documentElement;
    root.lang = settings.lang;
    root.dir = settings.lang === 'ar' ? 'rtl' : 'ltr';
    root.dataset.look = settings.look;
    root.dataset.layout = layout;
    root.dataset.contrast = String(settings.toggles.contrast);
    root.dataset.large = String(settings.toggles.largeText);
    root.dataset.motion = settings.toggles.reduceMotion ? 'reduce' : 'full';
    root.dataset.simple = String(settings.toggles.simple);
  }, [settings, layout]);

  const value = useMemo<Ctx>(
    () => ({
      settings,
      layout,
      detected: detectLayout(width),
      width,
      t: strings[settings.lang],
      update: (patch) => setSettings((s) => ({ ...s, ...patch })),
      toggle: (id) => setSettings((s) => ({ ...s, toggles: { ...s.toggles, [id]: !s.toggles[id] } })),
    }),
    [settings, layout, width],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
