import { splitFamilies } from './font-families';
import type { FontSnapshot } from './types';

const ICON_FONT = /(?:font\s*awesome|material\s*(?:icons|symbols)|iconfont|icomoon|glyphicons|bootstrap-icons|remixicon|tabler-icons|fluent\s*(?:system\s*)?icons|bootstrapicons|octicons|codicon|ionicons)/i;
const MATH_FONT = /(?:katex|mathjax|cambria math|stix.*math)/i;
const ICON_CLASS = /(?:^|\s)(?:material-icons(?:-[\w-]+)?|material-symbols-[\w-]+|iconfont|glyphicon|fa|fas|far|fab|fal|fad|fat|fass|fasr|fasl)(?:\s|$)/i;
const PRIVATE_USE = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;
const ENCRYPTED_FONTS = new Set(['exam-data-decrypt-font']);
export const SPECIAL_SUBTREE = 'svg, math, .katex, .MathJax, .MathJax_Display, .MathJax_SVG, mjx-container, .xuetangx-com-encrypted-font';

export function isProtected(element: Element, font: FontSnapshot): boolean {
  if (element.matches(SPECIAL_SUBTREE) || ICON_FONT.test(font.fontFamily)
    || MATH_FONT.test(font.fontFamily)
    // These faces map unrelated code points to readable glyphs; fallback order is essential.
    || splitFamilies(font.fontFamily).some(family => !family.generic && ENCRYPTED_FONTS.has(family.name))
    || ICON_CLASS.test(element.getAttribute('class') || '')) return true;
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE && PRIVATE_USE.test(child.textContent || '')) return true;
  }
  for (const pseudo of ['::before', '::after', '::marker']) {
    const style = getComputedStyle(element, pseudo);
    if (style.content && !['none', 'normal', '""', "''"].includes(style.content)
      && (ICON_FONT.test(style.fontFamily) || MATH_FONT.test(style.fontFamily)
        || PRIVATE_USE.test(style.content))) return true;
  }
  return false;
}
