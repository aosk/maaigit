import { useId } from 'react';

/** The MAAI mark: a date with a palm leaflet, drawn in the current text colour. */
export function Logo({ size = 32, title }: { size?: number; title?: string }) {
  const mask = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <mask id={mask}>
          <rect width="64" height="64" fill="#fff" />
          <path d="M27 26.5c-1.7 7-1.1 14.5 2 21" transform="rotate(-22 32 37)" fill="none" stroke="#000" strokeWidth={2} strokeLinecap="round" />
        </mask>
      </defs>
      <g fill="currentColor" mask={`url(#${mask})`}>
        <path transform="rotate(-22 32 37)" d="M32 17c7.5 0 11 10 11 21s-4.5 20-11 20s-11-9-11-20s3.5-21 11-21z" />
        <path d="M33.5 17.5C38 11 46 6.5 55 6c-3.5 6.5-11.5 11.2-21.5 11.5z" />
      </g>
    </svg>
  );
}
