import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

// The bot is one file (it updates itself by replacing it), so its pure checks cannot live in a module it imports.
// This runs just the block between the GUARDS markers.
const source = fs.readFileSync(new URL('../device-bot/bot.mjs', import.meta.url), 'utf8');
const block = /\/\/ GUARDS-START[^\n]*\n([\s\S]*?)\/\/ GUARDS-END/.exec(source)?.[1] ?? '';
const guards = vm.runInNewContext(`${block}\n({ OPENABLE, RUNNABLE, FAR_AWAY, isProgramPath, isPrivateHost, checkOpenUrl, isPhone });`, { URL }) as {
  OPENABLE: RegExp;
  RUNNABLE: RegExp;
  FAR_AWAY: RegExp;
  isProgramPath: (file: string) => boolean;
  isPrivateHost: (host: string) => boolean;
  checkOpenUrl: (target: string) => string;
  isPhone: (phone: unknown) => boolean;
};

describe('device bot: open a link', () => {
  it('opens ordinary public web addresses', () => {
    expect(guards.checkOpenUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(guards.checkOpenUrl('http://8.8.8.8/')).toBe('http://8.8.8.8/');
    expect(guards.checkOpenUrl('https://[2606:4700::1111]/')).toContain('2606:4700');
  });

  it('refuses other schemes', () => {
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com', 'data:text/html,x', 'smb://host/share', 'not a url', '']) {
      expect(() => guards.checkOpenUrl(bad), bad).toThrow();
    }
  });

  it('refuses this computer and its own network, however the address is written', () => {
    for (const bad of [
      'http://localhost:3000', 'http://LOCALHOST./', 'http://app.localhost/', 'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/',
      'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://172.31.255.255/', 'http://169.254.169.254/latest', 'http://0.0.0.0/', 'http://100.64.0.1/',
      'http://[::1]/', 'http://[::]/', 'http://[fc00::1]/', 'http://[fd12:3456::1]/', 'http://[fe80::1]/', 'http://[febf::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:192.168.0.1]/',
      'http://router/', 'http://printer.local/', 'http://nas.lan/',
    ]) {
      expect(() => guards.checkOpenUrl(bad), bad).toThrow();
    }
    for (const fine of ['http://172.15.0.1/', 'http://172.32.0.1/', 'http://11.0.0.1/', 'http://192.169.0.1/', 'http://169.253.0.1/']) {
      expect(guards.checkOpenUrl(fine), fine).toBeTruthy();
    }
  });

  it('refuses links that hide their host behind a login part', () => {
    expect(() => guards.checkOpenUrl('https://bank.com@evil.example/')).toThrow();
  });
});

describe('device bot: reply number', () => {
  it('takes digits only, 7 to 15 of them', () => {
    for (const ok of ['1234567', '123456789012345']) expect(guards.isPhone(ok), ok).toBe(true);
    expect(guards.isPhone('966500000001')).toBe(true);
    for (const bad of ['123456', '1234567890123456', '+966500000001', '9665 0000', '966500000001@c.us', '12345678\n', 'abc', '', 966500000001, null, undefined]) {
      expect(guards.isPhone(bad), String(bad)).toBe(false);
    }
  });
});

describe('device bot: open a file', () => {
  it('refuses programs, scripts, program folders and macro-capable Office files', () => {
    for (const bad of [
      '/Users/a/Documents/Tool.app', '/Users/a/Documents/Tool.app/Contents/Info.plist', '/Users/a/Downloads/x.pkg', 'C:\\Users\\a\\Desktop\\setup.exe', '/home/a/run.sh', '/home/a/x.py',
      '/home/a/a.doc', '/home/a/a.xls', '/home/a/a.ppt', '/home/a/a.docm', '/home/a/a.xlsm', '/home/a/a.pptm', '/home/a/a.dotm', '/home/a/a.xlsb', '/home/a/a.XLSM',
      '/home/a/x.rb', '/home/a/x.pl', '/home/a/x.php', '/home/a/x.dll', '/home/a/x.dmg', '/home/a/x.chm', '/home/a/x.vbs', '/home/a/Thing.workflow',
    ]) {
      expect(guards.isProgramPath(bad), bad).toBe(true);
    }
  });

  it('lets documents, pictures and plain folders through', () => {
    for (const ok of ['/home/a/Documents/report.pdf', '/home/a/Documents/Reports', '/home/a/Desktop/photo.JPG', '/home/a/Documents/notes.docx', '/home/a/Documents/sheet.xlsx', '/home/a/Documents/deck.pptx']) {
      expect(guards.isProgramPath(ok), ok).toBe(false);
    }
    expect(guards.OPENABLE.test('a.docx')).toBe(true);
    for (const old of ['a.doc', 'a.xls', 'a.ppt', 'a.docm']) expect(guards.OPENABLE.test(old), old).toBe(false);
  });

  it('still refuses network and device paths', () => {
    for (const bad of ['\\\\server\\share\\a.pdf', '//server/share', '\\\\?\\C:\\a.pdf', '\\\\.\\COM1']) expect(guards.FAR_AWAY.test(bad), bad).toBe(true);
    expect(guards.FAR_AWAY.test('C:\\Users\\a\\a.pdf')).toBe(false);
  });
});
