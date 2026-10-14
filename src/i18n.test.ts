import { describe, expect, it } from 'vitest';
import { strings } from './i18n';

type Tree = { [key: string]: unknown };

/** Every text in a language, by its path ("notifyKinds.briefing.0"), with how many values a function takes. */
function flatten(value: unknown, path = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === 'function') out.set(path, `function/${value.length}`);
  else if (Array.isArray(value)) value.forEach((item, i) => flatten(item, `${path}.${i}`).forEach((v, k) => out.set(k, v)));
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value as Tree)) flatten(item, path ? `${path}.${key}` : key).forEach((v, k) => out.set(k, v));
  else out.set(path, typeof value);
  return out;
}

describe('the two languages', () => {
  const en = flatten(strings.en);
  const ar = flatten(strings.ar);

  it('have the same texts: nothing is missing in Arabic, nothing is left over', () => {
    const missingInArabic = [...en.keys()].filter((key) => !ar.has(key));
    const missingInEnglish = [...ar.keys()].filter((key) => !en.has(key));
    expect({ missingInArabic, missingInEnglish }).toEqual({ missingInArabic: [], missingInEnglish: [] });
  });

  it('take the same values in the functions that build sentences', () => {
    const different = [...en].filter(([key, kind]) => ar.has(key) && ar.get(key) !== kind).map(([key, kind]) => `${key}: en ${kind}, ar ${ar.get(key)}`);
    expect(different).toEqual([]);
  });

  it('have no empty texts', () => {
    for (const [name, language] of Object.entries(strings)) {
      const empty = [...flatten(language)].filter(([key, kind]) => kind === 'string' && (language as unknown as Record<string, unknown>) && getPath(language, key) === '').map(([key]) => key);
      expect(empty, name).toEqual([]);
    }
  });
});

function getPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Tree | unknown[])?.[key as never], root);
}
