import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '../shared/types';
import { strings, type Strings } from './i18n';

export type Look = 'system' | 'light' | 'dark';
export type ToggleId = keyof Strings['toggles'];

export interface Settings {
  lang: Lang;
  look: Look;
  toggles: Record<ToggleId, boolean>;
}

const DEFAULTS: Settings = {
  lang: 'en',
  look: 'system',
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
  update: (patch: Partial<Settings>) => void;
  toggle: (id: ToggleId) => void;
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // Private windows can refuse storage; settings then last for this visit only.
    }
    const root = document.documentElement;
    root.lang = settings.lang;
    root.dir = settings.lang === 'ar' ? 'rtl' : 'ltr';
    root.dataset.look = settings.look;
    root.dataset.contrast = String(settings.toggles.contrast);
    root.dataset.large = String(settings.toggles.largeText);
    root.dataset.motion = settings.toggles.reduceMotion ? 'reduce' : 'full';
    root.dataset.simple = String(settings.toggles.simple);
  }, [settings]);

  const value = useMemo<Ctx>(
    () => ({
      settings,
      t: strings[settings.lang],
      update: (patch) => setSettings((s) => ({ ...s, ...patch })),
      toggle: (id) => setSettings((s) => ({ ...s, toggles: { ...s.toggles, [id]: !s.toggles[id] } })),
    }),
    [settings],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
}
