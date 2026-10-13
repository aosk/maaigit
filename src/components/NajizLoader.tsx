import { useEffect, useState } from 'react';
import { useSettings } from '../settings';

const PHRASE = 'ناجز ينجزك';
const TYPE_MS = 110;
const ERASE_MS = 55;
const HOLD_MS = 1300;

/**
 * Shown while MAAI works: the Najiz checkmark, fading out and back in, with
 * "ناجز ينجزك" typing itself out, pausing, erasing and starting again.
 */
export function NajizLoader() {
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
    <div className="najiz-loader" aria-hidden="true">
      <span className="najiz-logo">
        <img src="/najiz-check.svg" alt="" width={86} height={70} />
      </span>
      <span className="najiz-phrase" dir="rtl" lang="ar">
        {PHRASE.slice(0, shown)}
        <span className="najiz-caret" />
      </span>
    </div>
  );
}
