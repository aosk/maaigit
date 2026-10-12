/** Turning notifications on and off for this browser or phone. */

export const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

/** Registers the service worker once; null when the browser refuses (for example an untrusted certificate). */
export function worker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  registration ??= navigator.serviceWorker.register('/sw.js').catch(() => null);
  return registration;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await worker();
  return reg ? reg.pushManager.getSubscription() : null;
}

function keyBytes(base64url: string): ArrayBuffer {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer;
}

export type EnableResult = 'ok' | 'denied' | 'no-worker' | 'unsupported';

export async function enablePush(publicKey: string, send: (sub: PushSubscription) => Promise<void>): Promise<EnableResult> {
  if (!pushSupported) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await worker();
  if (!reg) return 'no-worker';
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await send(sub);
  return 'ok';
}

export async function disablePush(drop: (endpoint: string) => Promise<void>) {
  const sub = await currentSubscription();
  if (!sub) return;
  await drop(sub.endpoint);
  await sub.unsubscribe();
}
