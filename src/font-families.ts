import type { FontFamily } from './types';

const GENERICS = new Set([
  'serif', 'sans-serif', 'monospace', 'system-ui', 'ui-serif', 'ui-sans-serif',
  'ui-monospace', 'ui-rounded', 'cursive', 'fantasy', 'math', 'fangsong',
]);

// CSSOM canonicalizes family names; splitting must still respect quoted commas.
export function splitFamilies(value: string): FontFamily[] {
  const parts: FontFamily[] = [];
  let start = 0;
  let quote = '';
  for (let i = 0; i <= value.length; i++) {
    const char = value[i];
    if (char === '\\') { i++; continue; }
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ',' || i === value.length) {
      const raw = value.slice(start, i).trim();
      if (!raw) return [];
      const quoted = raw[0] === '"' || raw[0] === "'";
      const name = (quoted ? raw.slice(1, -1) : raw).replace(
        /\\([0-9a-f]{1,6}\s?|[^\r\n\f])/gi,
        (_: string, escaped: string) => /^[0-9a-f]/i.test(escaped)
          ? String.fromCodePoint(Math.min(parseInt(escaped.trim(), 16) || 0xfffd, 0x10ffff))
          : escaped,
      ).toLowerCase();
      parts.push({ name, generic: !quoted && GENERICS.has(name), raw });
      start = i + 1;
    }
  }
  return quote ? [] : parts;
}

export function prepend(preferred: string, original: string): string {
  const prefix = splitFamilies(preferred);
  const families = splitFamilies(original);
  if (prefix.every((family, index) => family.name === families[index]?.name
    && family.generic === families[index]?.generic)) return original;
  return `${preferred}, ${original}`;
}
