/**
 * Screen types. MAAI picks one from the width of the window (so it follows a fold opening, a tablet turning, or a
 * browser being resized), and the person can fix one in Settings.
 */
export type Layout = 'phone' | 'tablet' | 'desktop';
export type LayoutChoice = 'auto' | Layout;

/** Windows narrower than this are a phone, and from the second number up a computer. */
const TABLET_FROM = 600;
const DESKTOP_FROM = 1024;

export function detectLayout(width: number): Layout {
  if (width >= DESKTOP_FROM) return 'desktop';
  if (width >= TABLET_FROM) return 'tablet';
  return 'phone';
}

export const effectiveLayout = (choice: LayoutChoice, width: number): Layout => (choice === 'auto' ? detectLayout(width) : choice);
