import { phoneDigits } from '../shared/vcard';

/** The phone's own contact picker (Android Chrome and Samsung Internet): the user picks people; nothing else is read. */

interface PickedContact {
  name?: string[];
  tel?: string[];
}
interface ContactsManager {
  select(properties: ('name' | 'tel')[], options?: { multiple?: boolean }): Promise<PickedContact[]>;
}

const manager = (): ContactsManager | undefined => (navigator as Navigator & { contacts?: ContactsManager }).contacts;

export const canPickContacts = () => typeof window !== 'undefined' && 'ContactsManager' in window && Boolean(manager());

/** "Name (+9665…)" for each picked contact, ready to drop into a message to the assistant. */
export async function pickContacts(): Promise<string> {
  const picked = await manager()!.select(['name', 'tel'], { multiple: true });
  return picked
    .map((c) => {
      const tel = c.tel?.[0] ? phoneDigits(c.tel[0]) : '';
      const name = c.name?.[0]?.trim() ?? '';
      return tel ? `${name || tel} (+${tel})` : name;
    })
    .filter(Boolean)
    .join('، ');
}
