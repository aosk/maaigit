import { useEffect, useState } from 'react';
import { useSettings } from '../settings';
import { Logo } from './Logo';

const PHRASE = [...'معي، يومك أوضح'];
const TYPE_MS = 110;
const ERASE_MS = 55;
const HOLD_MS = 1300;

/**
 * Shown while maai works: the «م» mark breathing (fading out and back in, its dot pulsing just after), with
 * «معي، يومك أوضح» typing itself out, pausing, erasing and starting again. Still when motion is reduced.
 */
export function MaaiLoader() {
  const { settings } = useSettings();
  const still = settings.toggles.reduceMotion;
  const [shown, setShown] = useState(still ? PHRASE.length : 0);
  const [erasing, setErasing] = useState(false);

  useEffect(() => {
    if (still) return;
    const full = shown === PHRASE.length;
    const delay = full && !erasing ? HOLD_MS : erasing ? ERASE_MS : TYPE_MS;
    const timer = setTimeout(() => {
      if (full && !erasing) setErasing(true);
      else if (erasing && shown === 0) setErasing(false);
      else setShown((n) => n + (erasing ? -1 : 1));
    }, delay);
    return () => clearTimeout(timer);
  }, [shown, erasing, still]);

  return (
    <div className="maai-loader" aria-hidden="true">
      <span className="maai-mark">
        <Logo size={24} />
        <i className="maai-dot" />
      </span>
      <span className="maai-phrase" dir="rtl" lang="ar">
        {PHRASE.slice(0, shown).join('')}
        <span className="maai-caret" />
      </span>
    </div>
  );
}
