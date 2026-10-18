export const CATEGORIES = ['sans', 'serif', 'mono'] as const;
export type FontCategory = typeof CATEGORIES[number];
export type FontSettings = Record<FontCategory, string>;

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
}
