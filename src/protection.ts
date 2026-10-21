import { splitFamilies } from './font-families';
import type { Classifier } from './classifier';
import type { FontSnapshot } from './types';

const ICON_FONT = /(?:font\s*awesome|material\s*(?:icons|symbols)|iconfont|icomoon|glyphicons|bootstrap-icons|remixicon|tabler-icons|fluent\s*(?:system\s*)?icons|bootstrapicons|octicons|codicon|ionicons)/i;
const MATH_FONT = /(?:katex|mathjax|cambria math|stix|latin modern math|xits math|tex gyre|asana math|noto (?:(?:sans|serif) )?math|libertinus math|fira math|garamond math)/i;
const ICON_CLASS = /(?:^|\s)(?:material-icons(?:-[\w-]+)?|material-symbols-[\w-]+|iconfont|glyphicon|fa|fas|far|fab|fal|fad|fat|fass|fasr|fasl)(?:\s|$)/i;
const PRIVATE_USE = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;
const ENCRYPTED_FONTS = new Set(['exam-data-decrypt-font']);
const EMPTY_CONTENT = new Set(['none', 'normal', '""', "''"]);
const LIGATURE_WORDS = ['home', 'search', 'settings', 'arrow_back'];
// Material Icons measures about 0.25; proportional text stays at 1.00.
const LIGATURE_RATIO = 0.6;
const PSEUDO_ELEMENTS = /::?(?:before|after|marker)\b/gi;
const PSEUDO_ELEMENT = /::?(?:before|after|marker)\b/i;

interface PseudoIndex {
  selectors: string[];
  // False when a cross-origin or otherwise unreadable sheet could hide pseudo rules.
  complete: boolean;
}

/** Split a selector list on top-level commas, ignoring quotes and grouping. */
function splitSelectors(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote = '';
  let depth = 0;
  for (let index = 0; index <= value.length; index++) {
    const char = value[index];
    if (char === '\\') { index++; continue; }
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if ((char === ',' && depth === 0) || index === value.length) {
      const part = value.slice(start, index).trim();
      if (part) parts.push(part);
      start = index + 1;
    }
  }
  return parts;
}

export const SPECIAL_SUBTREE = [
  'svg', 'math', '.katex', '.MathJax', '.MathJax_Display', '.MathJax_SVG', 'mjx-container',
  '.mwe-math-element', '.math', '.formula', '.equation', '.xuetangx-com-encrypted-font',
].join(', ');

export function createProtector(classifier: Classifier) {
  const ligatureCache = new Map<string, boolean>();
  let webFamilies: Set<string> = new Set();
  let webFamilyFingerprint: string | null = null;
  let pseudoIndex: PseudoIndex | null = null;

  function webFontFamilies(): Set<string> {
    const fonts = document.fonts;
    if (!fonts) return webFamilies;
    const families = new Set<string>();
    fonts.forEach(face => {
      const name = face.family.trim().replace(/^["']|["']$/g, '').toLowerCase();
      if (name) families.add(name);
    });
    // A face can be added while another is removed, leaving `size` unchanged.
    const fingerprint = [...families].sort().join('\n');
    if (fingerprint !== webFamilyFingerprint) {
      webFamilyFingerprint = fingerprint;
      webFamilies = families;
    }
    return webFamilies;
  }

  function preferredWebFamily(font: FontSnapshot): string | null {
    // Only the preferred (first) family decides; a generic can never resolve to a web font.
    const [first] = splitFamilies(font.fontFamily);
    if (!first || first.generic) return null;
    return webFontFamilies().has(first.name) ? first.name : null;
  }

  function isLigatureIconFont(font: FontSnapshot, language: string, cacheKey: string): boolean {
    const cached = ligatureCache.get(cacheKey);
    if (cached !== undefined) return cached;
    let result = false;
    if (preferredWebFamily(font)) {
      classifier.applyFont(font, language);
      let ratio = Infinity;
      for (const word of LIGATURE_WORDS) {
        const whole = classifier.measure(word);
        let sum = 0;
        for (const character of word) sum += classifier.measure(character);
        if (whole > 0 && sum > 0) ratio = Math.min(ratio, whole / sum);
      }
      result = ratio < LIGATURE_RATIO;
    }
    if (ligatureCache.size >= 512) ligatureCache.clear();
    ligatureCache.set(cacheKey, result);
    return result;
  }

  /**
   * Pseudo content and fonts only need checking on elements a stylesheet makes
   * generate them. Collect the selectors of pseudo rules once per stylesheet
   * generation; elements outside every one of them cannot have protected pseudos.
   */
  function collectPseudoIndex(): PseudoIndex {
    const selectors = new Set<string>();
    let complete = true;

    const add = (selectorText: string): void => {
      if (!PSEUDO_ELEMENT.test(selectorText)) return;
      for (const selector of splitSelectors(selectorText)) {
        selectors.add(selector.replace(PSEUDO_ELEMENTS, '').trim() || '*');
      }
    };

    const walk = (rules: CSSRuleList): void => {
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule) {
          add(rule.selectorText);
          // CSS nesting puts child rules inside their parent style rule.
          const nested = (rule as CSSStyleRule & { cssRules?: CSSRuleList }).cssRules;
          if (nested?.length) walk(nested);
          continue;
        }
        if (rule instanceof CSSImportRule) {
          try {
            if (rule.styleSheet) walk(rule.styleSheet.cssRules);
          } catch {
            complete = false;
          }
          continue;
        }
        const grouping = (rule as CSSGroupingRule).cssRules;
        if (grouping) walk(grouping);
      }
    };

    const sheets: CSSStyleSheet[] = [
      ...document.styleSheets,
      ...(document.adoptedStyleSheets ?? []),
    ];
    for (const sheet of sheets) {
      try {
        if (!sheet.cssRules) {
          complete = false;
          continue;
        }
        walk(sheet.cssRules);
      } catch {
        // Cross-origin sheets cannot be inspected; fall back to per-element checks.
        complete = false;
      }
    }
    return { selectors: [...selectors], complete };
  }

  function pseudoCandidates(root: Element): Set<Element> | null {
    pseudoIndex ??= collectPseudoIndex();
    if (!pseudoIndex.complete) return null;
    const candidates = new Set<Element>();
    if (!pseudoIndex.selectors.length) return candidates;
    const selector = pseudoIndex.selectors.join(',');
    try {
      if (root.matches(selector)) candidates.add(root);
      for (const element of root.querySelectorAll(selector)) candidates.add(element);
    } catch {
      // An unparsable selector (for example a nested `&`) must not hide protection.
      return null;
    }
    return candidates;
  }

  function hasProtectedPseudo(element: Element): boolean {
    for (const pseudo of ['::before', '::after', '::marker']) {
      const style = getComputedStyle(element, pseudo);
      if (style.content && !EMPTY_CONTENT.has(style.content)
        && (ICON_FONT.test(style.fontFamily) || MATH_FONT.test(style.fontFamily)
          || PRIVATE_USE.test(style.content))) return true;
    }
    return false;
  }

  function isProtected(
    element: Element,
    font: FontSnapshot,
    language: string,
    cacheKey: string,
    inspectPseudo = true,
  ): boolean {
    if (element.matches(SPECIAL_SUBTREE) || ICON_FONT.test(font.fontFamily)
      || MATH_FONT.test(font.fontFamily)
      || splitFamilies(font.fontFamily).some(family => family.name === 'math'
        || (!family.generic && ENCRYPTED_FONTS.has(family.name)))
      || ICON_CLASS.test(element.getAttribute('class') || '')) return true;
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && PRIVATE_USE.test(child.textContent || '')) return true;
    }
    return (inspectPseudo && hasProtectedPseudo(element))
      || isLigatureIconFont(font, language, cacheKey);
  }

  return {
    isProtected,
    pseudoCandidates,
    clearCache(): void {
      ligatureCache.clear();
      webFamilyFingerprint = null;
      pseudoIndex = null;
    },
  };
}
