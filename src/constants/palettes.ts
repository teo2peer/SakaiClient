/**
 * Color palettes the user can pick from in Settings.
 *
 * Every brand color of the app is a CSS variable (see `src/global.css` and
 * `tailwind.config.js`). At runtime `<ThemedSurface>` injects the selected
 * palette with NativeWind's `vars()`, so every `bg-pine`, `text-ink`, ...
 * class follows the choice without any component knowing about palettes.
 */

export const PALETTE_IDS = [
  'pine',
  'indigo',
  'ocean',
  'slate',
  'olive',
  'amber',
  'cocoa',
  'red',
  'crimson',
  'rose',
  'plum',
  'graphite',
] as const;

export type PaletteId = (typeof PALETTE_IDS)[number];

export type ColorScheme = 'light' | 'dark';
export const COLOR_SCHEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export type ColorSchemePreference = (typeof COLOR_SCHEME_PREFERENCES)[number];

export function isColorSchemePreference(value: unknown): value is ColorSchemePreference {
  return COLOR_SCHEME_PREFERENCES.includes(value as ColorSchemePreference);
}

export function resolveColorScheme(preference: ColorSchemePreference, system: string | null | undefined): ColorScheme {
  return preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
}

/** Brand tokens. Names match the Tailwind color keys. */
export type PaletteTokens = {
  /** Primary text and headings. */
  ink: string;
  /** Accent: primary buttons, links, active states. */
  pine: string;
  /** Text and icons drawn on top of `pine`. */
  pineContrast: string;
  /** Soft accent surface behind the accent color. */
  mint: string;
  /** App background. */
  paper: string;
  /** Borders and separators. */
  line: string;
  /** Destructive actions and errors. Shared by every palette. */
  ember: string;
};

export const DEFAULT_PALETTE_ID: PaletteId = 'pine';

/** Danger stays semantic: it never changes with the palette, only with the scheme. */
const EMBER: Record<ColorScheme, string> = { light: '#B84E32', dark: '#F87171' };

/** `ember` and `pineContrast` are derived, so palettes only declare the rest. */
type PaletteColors = Omit<PaletteTokens, 'ember' | 'pineContrast'>;

type PaletteDefinition = {
  name: string;
  description: string;
  light: PaletteColors;
  dark: PaletteColors;
};

export const PALETTES: Record<PaletteId, PaletteDefinition> = {
  pine: {
    name: 'Bosque',
    description: 'Verde PoliformaT, el tema original.',
    light: { ink: '#17211B', pine: '#1F5B45', mint: '#DCEDE5', paper: '#F5F7F4', line: '#D8DED9' },
    dark: { ink: '#FAFAFA', pine: '#6EE7B7', mint: '#052E23', paper: '#09090B', line: '#27272A' },
  },
  indigo: {
    name: 'Índigo',
    description: 'Azul profundo, sobrio y de alto contraste.',
    light: { ink: '#191C2B', pine: '#3A4CA8', mint: '#E1E5F8', paper: '#F5F6FB', line: '#D9DDEC' },
    dark: { ink: '#FAFAFA', pine: '#A5B4FC', mint: '#1E1B4B', paper: '#09090B', line: '#27272A' },
  },
  ocean: {
    name: 'Océano',
    description: 'Turquesa fresco para lecturas largas.',
    light: { ink: '#12232A', pine: '#0F6E80', mint: '#D6ECF1', paper: '#F3F8F9', line: '#D2E0E4' },
    dark: { ink: '#FAFAFA', pine: '#67E8F9', mint: '#083344', paper: '#09090B', line: '#27272A' },
  },
  amber: {
    name: 'Ámbar',
    description: 'Tonos cálidos, menos luz azul.',
    light: { ink: '#241C10', pine: '#8F5410', mint: '#F7E9CE', paper: '#FAF7F1', line: '#E6DCC9' },
    dark: { ink: '#FAFAFA', pine: '#FCD34D', mint: '#451A03', paper: '#09090B', line: '#27272A' },
  },
  plum: {
    name: 'Ciruela',
    description: 'Violeta suave con acentos marcados.',
    light: { ink: '#221728', pine: '#7A3B8F', mint: '#EFE0F4', paper: '#F9F5FA', line: '#E3D6E8' },
    dark: { ink: '#FAFAFA', pine: '#D8B4FE', mint: '#3B0764', paper: '#09090B', line: '#27272A' },
  },
  slate: {
    name: 'Pizarra',
    description: 'Gris azulado, discreto y neutro.',
    light: { ink: '#16202B', pine: '#3D566E', mint: '#DFE7EF', paper: '#F4F7FA', line: '#D5DEE7' },
    dark: { ink: '#FAFAFA', pine: '#BAD1E8', mint: '#172033', paper: '#09090B', line: '#27272A' },
  },
  olive: {
    name: 'Oliva',
    description: 'Verde oliva, terroso y apagado.',
    light: { ink: '#1E2114', pine: '#55651F', mint: '#E6EDCF', paper: '#F7F9F1', line: '#DDE4CC' },
    dark: { ink: '#FAFAFA', pine: '#D9E886', mint: '#26310A', paper: '#09090B', line: '#27272A' },
  },
  cocoa: {
    name: 'Cacao',
    description: 'Marrón cálido, de baja saturación.',
    light: { ink: '#221A15', pine: '#6F4A2F', mint: '#EEE1D6', paper: '#FAF6F2', line: '#E2D5C9' },
    dark: { ink: '#FAFAFA', pine: '#E0BFA3', mint: '#33210F', paper: '#09090B', line: '#27272A' },
  },
  red: {
    name: 'Rojo',
    description: 'Rojo intenso. Se parece al color de las acciones destructivas.',
    light: { ink: '#261615', pine: '#B3261E', mint: '#F9DEDC', paper: '#FBF6F5', line: '#EDD9D7' },
    dark: { ink: '#FAFAFA', pine: '#FCA5A5', mint: '#450A0A', paper: '#09090B', line: '#27272A' },
  },
  crimson: {
    name: 'Carmesí',
    description: 'Rojo profundo con matiz vino.',
    light: { ink: '#26131A', pine: '#9F1239', mint: '#FBDDE6', paper: '#FBF5F7', line: '#EDD5DD' },
    dark: { ink: '#FAFAFA', pine: '#FDA4AF', mint: '#4C0519', paper: '#09090B', line: '#27272A' },
  },
  rose: {
    name: 'Rosa',
    description: 'Magenta suave, alegre y con buen contraste.',
    light: { ink: '#2A1622', pine: '#A83A78', mint: '#F9DEEF', paper: '#FCF5F9', line: '#EED8E5' },
    dark: { ink: '#FAFAFA', pine: '#F9A8D4', mint: '#500724', paper: '#09090B', line: '#27272A' },
  },
  graphite: {
    name: 'Grafito',
    description: 'Escala de grises, sin color de marca.',
    light: { ink: '#18181B', pine: '#3F3F46', mint: '#E4E4E7', paper: '#F6F6F7', line: '#D4D4D8' },
    dark: { ink: '#FAFAFA', pine: '#D4D4D8', mint: '#27272A', paper: '#09090B', line: '#3F3F46' },
  },
};

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && (PALETTE_IDS as readonly string[]).includes(value);
}

/** Resolved hex colors, for props that cannot take a class name (tintColor, ActivityIndicator...). */
export function paletteTokens(id: PaletteId, scheme: ColorScheme): PaletteTokens {
  const palette = PALETTES[id][scheme];
  // Light accents are deep enough for white; dark accents are pastel, so the
  // deep tint of the same hue becomes the readable foreground.
  const pineContrast = scheme === 'light' ? '#FFFFFF' : palette.mint;
  return { ...palette, pineContrast, ember: EMBER[scheme] };
}

/** `#1F5B45` -> `31 91 69`, the channel form Tailwind needs for `<alpha-value>` support. */
export function hexToChannels(hex: string): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.replace(/./g, (char) => char + char) : value;
  const int = Number.parseInt(full, 16);
  return `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`;
}

/** CSS custom properties for a palette, ready for NativeWind's `vars()`. */
export function paletteVariables(id: PaletteId, scheme: ColorScheme): Record<string, string> {
  const tokens = paletteTokens(id, scheme);
  return Object.fromEntries(
    Object.entries(tokens).map(([token, hex]) => [
      `--color-${token.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`,
      hexToChannels(hex),
    ]),
  );
}
