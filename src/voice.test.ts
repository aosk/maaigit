import { describe, expect, it } from 'vitest';
import { cleanForSpeech, pickVoice, qualityOf, rankVoices, scoreVoice, sentences, type VoiceInfo } from './voice';

const v = (name: string, voiceURI: string, lang: string, localService = true): VoiceInfo => ({ name, voiceURI, lang, localService });

/** What an iPhone with a few extra voices downloaded reports. */
const IPHONE: VoiceInfo[] = [
  v('Samantha', 'com.apple.voice.compact.en-US.Samantha', 'en-US'),
  v('Daniel', 'com.apple.voice.compact.en-GB.Daniel', 'en-GB'),
  v('Ava (Premium)', 'com.apple.voice.premium.en-US.Ava', 'en-US'),
  v('Zoe (Enhanced)', 'com.apple.voice.enhanced.en-US.Zoe', 'en-US'),
  v('Zarvox', 'com.apple.speech.synthesis.voice.Zarvox', 'en-US'),
  v('Bad News', 'com.apple.speech.synthesis.voice.BadNews', 'en-US'),
  v('Majed', 'com.apple.voice.compact.ar-SA.Maged', 'ar-SA'),
  v('Majed (Enhanced)', 'com.apple.voice.enhanced.ar-SA.Maged', 'ar-SA'),
  v('Tarik', 'com.apple.voice.compact.ar-SA.Tarik', 'ar-SA'),
  v('Laila', 'com.apple.voice.compact.ar-001.Laila', 'ar-001'),
];

describe('choosing the voice', () => {
  it('prefers a Premium or Enhanced voice over the basic one', () => {
    expect(pickVoice(IPHONE, 'en')?.name).toBe('Ava (Premium)');
    expect(pickVoice(IPHONE, 'ar')?.name).toBe('Majed (Enhanced)');
  });

  it('falls back to the best of what is there when only basic voices are installed', () => {
    const basic = IPHONE.filter((x) => qualityOf(x) === 'basic');
    expect(pickVoice(basic, 'en')?.name).toBe('Daniel'); // a favourite, in British English
    expect(pickVoice(basic, 'ar')?.name).toBe('Majed'); // Saudi Arabic first
  });

  it('never picks a novelty or joke voice, and never one for the wrong language', () => {
    const names = rankVoices(IPHONE, 'en').map((x) => x.name);
    expect(names).not.toContain('Zarvox');
    expect(names).not.toContain('Bad News');
    expect(names).not.toContain('Majed');
    expect(rankVoices(IPHONE, 'ar').every((x) => x.lang.startsWith('ar'))).toBe(true);
    expect(pickVoice([v('Zarvox', 'z', 'en-US')], 'en')).toBeUndefined();
  });

  it('lists the best first, and honours the one the person chose while it is still installed', () => {
    expect(rankVoices(IPHONE, 'en').map((x) => x.name).slice(0, 2)).toEqual(['Ava (Premium)', 'Zoe (Enhanced)']);
    expect(pickVoice(IPHONE, 'en', 'com.apple.voice.compact.en-GB.Daniel')?.name).toBe('Daniel');
    expect(pickVoice(IPHONE, 'en', 'a-voice-that-was-removed')?.name).toBe('Ava (Premium)');
  });

  it('recognises the natural-sounding voices of other browsers and ranks them above basic ones', () => {
    const desktop = [
      v('Microsoft Naayf - Arabic (Saudi Arabia)', 'naayf-local', 'ar-SA'),
      v('Microsoft Hamed Online (Natural) - Arabic (Saudi Arabia)', 'hamed-online', 'ar-SA', false),
      v('Google العربية', 'google-ar', 'ar-SA', false),
    ];
    expect(qualityOf(desktop[1])).toBe('natural');
    expect(pickVoice(desktop, 'ar')?.name).toContain('Hamed');
    expect(scoreVoice(desktop[1], 'ar')).toBeGreaterThan(scoreVoice(desktop[0], 'ar'));
  });

  it('copes with nothing installed, and with underscores in language codes', () => {
    expect(pickVoice([], 'en')).toBeUndefined();
    expect(pickVoice([v('Majed', 'x', 'ar_SA')], 'ar')?.name).toBe('Majed');
  });
});

describe('preparing text to be read aloud', () => {
  it('drops emoji, markdown marks and replaces web addresses', () => {
    expect(cleanForSpeech('**Good morning** 🌅 see https://maai.example/x?y=1 now', 'en')).toBe('Good morning see link now');
    expect(cleanForSpeech('صباح الخير ☀️ افتح https://maai.example الآن', 'ar')).toBe('صباح الخير افتح رابط الآن');
  });

  it('turns line breaks into pauses', () => {
    expect(cleanForSpeech('First line\nSecond line\n\nThird', 'en')).toBe('First line. Second line. Third');
  });

  it('splits into sentences in English and Arabic', () => {
    expect(sentences('You have two meetings. The first is at nine! Ready?')).toEqual(['You have two meetings.', 'The first is at nine!', 'Ready?']);
    expect(sentences('لديك اجتماعان. الأول الساعة التاسعة؟ جاهز!')).toEqual(['لديك اجتماعان.', 'الأول الساعة التاسعة؟', 'جاهز!']);
  });

  it('cuts a very long sentence at a comma or space, never mid-word, and loses nothing', () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ') + '.';
    const parts = sentences(long, 100);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join(' ')).toBe(long);
    expect(parts.every((p) => /^word\d+/.test(p) && /word\d+\.?$/.test(p))).toBe(true); // every piece starts and ends on a whole word
  });

  it('handles empty and punctuation-only text', () => {
    expect(sentences('')).toEqual([]);
    expect(cleanForSpeech('   ', 'en')).toBe('');
    expect(sentences('...')).toEqual(['...']);
  });
});
