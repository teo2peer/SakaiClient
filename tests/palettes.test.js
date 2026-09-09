import { expect, mock, test } from 'bun:test';
import {
  DEFAULT_PALETTE_ID,
  PALETTES,
  PALETTE_IDS,
  hexToChannels,
  isColorSchemePreference,
  isPaletteId,
  paletteTokens,
  paletteVariables,
  resolveColorScheme,
} from '../src/constants/palettes.ts';

const stored = new Map();
mock.module('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key) => stored.get(key) ?? null,
  setItem: async (key, value) => { stored.set(key, value); },
  removeItem: async (key) => { stored.delete(key); },
} }));
const { normalizeAppData } = await import('../src/lib/storage.ts');

const SCHEMES = ['light', 'dark'];

function relativeLuminance(hex) {
  const channels = hexToChannels(hex).split(' ').map((value) => {
    const ratio = Number(value) / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

test('converts hex colors to the channel triplets Tailwind interpolates', () => {
  expect(hexToChannels('#1F5B45')).toBe('31 91 69');
  expect(hexToChannels('#fff')).toBe('255 255 255');
  expect(hexToChannels('000000')).toBe('0 0 0');
});

test('exposes every token as a kebab-case CSS variable', () => {
  const variables = paletteVariables(DEFAULT_PALETTE_ID, 'light');
  expect(variables).toEqual({
    '--color-ink': '23 33 27',
    '--color-pine': '31 91 69',
    '--color-pine-contrast': '255 255 255',
    '--color-mint': '220 237 229',
    '--color-paper': '245 247 244',
    '--color-line': '216 222 217',
    '--color-ember': '184 78 50',
  });
});

test('keeps text readable over the accent and over the app background in both schemes', () => {
  // WCAG AA for text, AA non-text for the accent used as a border or fill.
  const failures = [];
  for (const id of PALETTE_IDS) {
    for (const scheme of SCHEMES) {
      const { pine, pineContrast, paper, ink } = paletteTokens(id, scheme);
      if (contrast(pine, pineContrast) < 4.5) failures.push(`${id}/${scheme}: label on accent`);
      if (contrast(pine, paper) < 3) failures.push(`${id}/${scheme}: accent on background`);
      if (contrast(ink, paper) < 4.5) failures.push(`${id}/${scheme}: text on background`);
    }
  }
  expect(failures).toEqual([]);
});

test('every palette declares both schemes and a unique accent', () => {
  expect(Object.keys(PALETTES).sort()).toEqual([...PALETTE_IDS].sort());
  const accents = PALETTE_IDS.map((id) => paletteTokens(id, 'light').pine);
  expect(new Set(accents).size).toBe(PALETTE_IDS.length);
});

test('falls back to the default palette when the stored value is missing or unknown', () => {
  expect(isPaletteId('pine')).toBe(true);
  expect(isPaletteId('neon')).toBe(false);
  expect(normalizeAppData({ settings: { palette: 'neon' } }).settings.palette).toBe(DEFAULT_PALETTE_ID);
  expect(normalizeAppData({}).settings.palette).toBe(DEFAULT_PALETTE_ID);
  expect(normalizeAppData({ settings: { palette: 'crimson' } }).settings.palette).toBe('crimson');
});

test('normalizes and resolves automatic, light and dark color preferences', () => {
  expect(isColorSchemePreference('system')).toBe(true);
  expect(isColorSchemePreference('sepia')).toBe(false);
  expect(normalizeAppData({ settings: { colorScheme: 'sepia' } }).settings.colorScheme).toBe('system');
  expect(normalizeAppData({ settings: { colorScheme: 'dark' } }).settings.colorScheme).toBe('dark');
  expect(resolveColorScheme('system', 'dark')).toBe('dark');
  expect(resolveColorScheme('system', null)).toBe('light');
  expect(resolveColorScheme('light', 'dark')).toBe('light');
});
