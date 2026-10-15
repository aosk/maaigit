import type { ReactNode } from 'react';

function Icon({ size = 24, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

type P = { size?: number };

export const Calendar = (p: P) => <Icon {...p}><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></Icon>;
export const Chat = (p: P) => <Icon {...p}><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.2-4.4A8 8 0 1 1 21 12z" /></Icon>;
export const Inbox = (p: P) => <Icon {...p}><path d="M4 4h16v12H8l-4 4V4z" /></Icon>;
export const Gear = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /></Icon>;
export const Mic = (p: P) => <Icon {...p}><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v4" /></Icon>;
export const Sun = (p: P) => <Icon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Icon>;
export const Speaker = (p: P) => <Icon {...p}><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></Icon>;
export const Send = (p: P) => <Icon {...p}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" /></Icon>;
export const Bell = (p: P) => <Icon {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></Icon>;
export const Plus = (p: P) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const Back = (p: P) => <Icon {...p}><path d="m15 18-6-6 6-6" /></Icon>;
export const Check = (p: P) => <Icon {...p}><path d="M20 6 9 17l-5-5" /></Icon>;
export const Trash = (p: P) => <Icon {...p}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></Icon>;
export const Moon = (p: P) => <Icon {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></Icon>;
export const Sunrise = (p: P) => <Icon {...p}><path d="M17 18a5 5 0 0 0-10 0" /><path d="M12 2v7M4.2 10.2l1.4 1.4M1 18h2M21 18h2M18.4 11.6l1.4-1.4M23 22H1M8 6l4-4 4 4" /></Icon>;
