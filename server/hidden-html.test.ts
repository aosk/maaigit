import { describe, expect, it } from 'vitest';
import { visibleText } from './hidden-html';

describe('visibleText (B-03)', () => {
  it('keeps what a person reads', () => {
    expect(visibleText('<p>Hello &amp; welcome</p><p>Second <b>line</b></p>')).toBe('Hello & welcome\n\nSecond line');
  });

  it.each([
    ['display:none', '<div style="display:none">SECRET</div>'],
    ['visibility:hidden', '<span style="visibility: hidden">SECRET</span>'],
    ['font-size:0', '<div style="font-size:0px">SECRET</div>'],
    ['opacity:0', '<div style="opacity:0">SECRET</div>'],
    ['zero height, overflow hidden', '<div style="height:0;overflow:hidden">SECRET</div>'],
    ['white on white', '<div style="color:#fff">SECRET</div>'],
    ['white on white, rgb', '<font color="white">SECRET</font>'],
    ['hidden attribute', '<p hidden>SECRET</p>'],
    ['aria-hidden', '<p aria-hidden="true">SECRET</p>'],
    ['comment', '<!-- SECRET -->'],
    ['script', '<script>SECRET</script>'],
    ['style element', '<style>SECRET{}</style>'],
    ['head', '<head><title>SECRET</title></head>'],
    ['nested inside hidden', '<div style="display:none"><p><b>SECRET</b></p></div>'],
    ['off-screen', '<div style="position:absolute;left:-9999px">SECRET</div>'],
  ])('drops text hidden with %s', (_name, hidden) => {
    const out = visibleText(`<p>Your statement is ready.</p>${hidden}<p>Thanks</p>`);
    expect(out).not.toContain('SECRET');
    expect(out).toContain('Your statement is ready.');
    expect(out).toContain('Thanks');
  });

  it('keeps white text on a dark background and text after a hidden block closes', () => {
    expect(visibleText('<td style="background-color:#003366"><span style="color:#fff">Pay now</span></td>')).toBe('Pay now');
    expect(visibleText('<div style="display:none">x</div>after')).toBe('after');
  });
});
