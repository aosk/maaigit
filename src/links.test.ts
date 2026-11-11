import { describe, expect, it } from 'vitest';
import { realHost, safeWebAddress, splitLinks, stripBidi } from './links';

describe('links in event notes', () => {
  it('links web addresses and leaves the words around them alone', () => {
    expect(splitLinks('Agenda: see https://example.com/spec.pdf and call')).toEqual([
      { text: 'Agenda: see ' },
      { text: 'https://example.com/spec.pdf', link: 'https://example.com/spec.pdf', host: 'example.com' },
      { text: ' and call' },
    ]);
  });

  it('never links anything but http and https', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', 'ftp://x.co', 'about:blank', '//evil.com', 'JaVaScRiPt:alert(1)']) {
      expect(safeWebAddress(bad), bad).toBeUndefined();
      expect(splitLinks(bad).every((p) => p.link === undefined), bad).toBe(true);
    }
    expect(safeWebAddress('https://meet.google.com/abc')).toBe('https://meet.google.com/abc');
    expect(safeWebAddress('http://example.com')).toBe('http://example.com/');
  });

  it('does not let a link hide inside other text to smuggle in a scheme', () => {
    const pieces = splitLinks('click https://ok.com/x"onmouseover="alert(1) or <a href="javascript:alert(1)">here</a>');
    for (const piece of pieces) if (piece.link) expect(piece.link).toMatch(/^https?:\/\//);
    expect(pieces.map((p) => p.text).join('')).toBe('click https://ok.com/x"onmouseover="alert(1) or <a href="javascript:alert(1)">here</a>');
  });

  it('keeps all the text, whatever it holds', () => {
    for (const text of ['', 'no links', 'https://a.co https://b.co', 'https://a.co\nhttps://b.co', '🙂 https://مثال.com/ص مرحبا']) {
      expect(splitLinks(text).map((p) => p.text).join('')).toBe(text);
    }
  });

  it('names the host the link really goes to, so its text cannot pose as another site', () => {
    const [look, login] = splitLinks('https://аpple.com/id bank.com https://bank.com@evil.example/x').filter((p) => p.link);
    expect(look.host).toBe('xn--pple-43d.com');
    expect(login.host).toBe('evil.example');
    expect(realHost('not a url')).toBe('');
  });

  it('removes characters that reorder or hide the text around them', () => {
    expect(stripBidi('evil\u202Etxt.pdf')).toBe('eviltxt.pdf');
    expect(stripBidi('a\u2066b\u2069c\u200Fd\u061Ce')).toBe('abcde');
    expect(stripBidi('مرحبا Ali')).toBe('مرحبا Ali');
  });
});
