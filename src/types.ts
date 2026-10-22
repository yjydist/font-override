export type FontCategory = 'sans' | 'serif' | 'mono';

// The browser's own standard / sans-serif / monospace settings decide the glyphs.
export const GENERIC_FAMILIES: Readonly<Record<FontCategory, string>> = Object.freeze({
  sans: 'sans-serif',
  serif: 'serif',
  mono: 'monospace',
});

export interface FontFamily {
  name: string;
  generic: boolean;
  raw: string;
}

export const FONT_PROPERTIES = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch',
  'fontVariant', 'fontFeatureSettings', 'fontVariationSettings', 'fontOpticalSizing',
] as const satisfies readonly (keyof CSSStyleDeclaration)[];

export type FontSnapshot = Pick<CSSStyleDeclaration, typeof FONT_PROPERTIES[number]>;
export type StyledElement = Element & { readonly style: CSSStyleDeclaration };

export interface InlineDeclaration {
  value: string;
  priority: string;
}

export interface ElementRecord {
  original: InlineDeclaration;
  applied: InlineDeclaration;
  font: FontSnapshot;
  language: string;
}

export function fontCacheKey(font: FontSnapshot, language: string): string {
  return JSON.stringify([...FONT_PROPERTIES.map(property => font[property]), language]);
}

export function readFont(computed: CSSStyleDeclaration): FontSnapshot {
  return Object.fromEntries(
    FONT_PROPERTIES.map(property => [property, computed[property]]),
  ) as FontSnapshot;
}
