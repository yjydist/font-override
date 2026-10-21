import { splitFamilies } from './font-families';
import { FONT_PROPERTIES, type FontCategory, type FontSnapshot } from './types';

const SERIF_NAMES = new Set([
  'times', 'times new roman', 'georgia', 'cambria', 'constantia', 'palatino',
  'palatino linotype', 'book antiqua', 'baskerville', 'didot', 'garamond',
  'liberation serif', 'noto serif', 'noto serif cjk sc', 'noto serif cjk tc',
  'noto serif cjk jp', 'noto serif sc', 'noto serif tc', 'noto serif jp',
  'source serif pro', 'source serif 4', 'source han serif sc', 'source han serif tc',
  'source han serif', 'songti sc', 'songti tc', 'stsong', 'simsun', 'nsimsun',
  '宋体', '新宋体', '华文宋体', '思源宋体', 'ヒラギノ明朝 pro n', 'yu mincho',
]);
const SANS_NAMES = new Set([
  'arial', 'helvetica', 'helvetica neue', 'verdana', 'tahoma', 'trebuchet ms',
  'segoe ui', 'calibri', 'inter', 'roboto', 'open sans', 'lato', 'ubuntu',
  'liberation sans', 'noto sans', 'noto sans cjk sc', 'noto sans cjk tc',
  'noto sans cjk jp', 'noto sans sc', 'noto sans tc', 'noto sans jp',
  'source sans pro', 'source sans 3', 'source han sans sc', 'source han sans tc',
  'source han sans', 'pingfang sc', 'pingfang tc', 'pingfang hk', 'heiti sc',
  'heiti tc', 'simhei', 'microsoft yahei', 'microsoft jhenghei', '微软雅黑',
  '黑体', '思源黑体', 'hiragino sans', 'yu gothic', '-apple-system', 'blinkmacsystemfont',
]);

export interface Classifier {
  host: HTMLElement;
  classify(font: FontSnapshot, language: string, cacheKey: string): FontCategory;
  applyFont(font: FontSnapshot, language: string): void;
  measure(text: string): number;
  ensureConnected(): void;
  clearCache(): void;
}

export function createClassifier(): Classifier {
  const classificationCache = new Map<string, FontCategory>();
  const host = document.createElement('div');
  // A closed root keeps site CSS and the document observer out of the measuring span.
  host.style.cssText = 'all:initial!important;position:fixed!important;left:-10000px!important;top:0!important;width:0!important;height:0!important;overflow:hidden!important;visibility:hidden!important;pointer-events:none!important;contain:strict!important;display:block!important;';
  host.setAttribute('aria-hidden', 'true');
  const probe = document.createElement('span');
  probe.style.cssText = 'all:initial;display:inline-block;position:absolute;white-space:pre;margin:0;padding:0;border:0;letter-spacing:0;word-spacing:0;font-kerning:none;';
  host.attachShadow({ mode: 'closed' }).append(probe);

  function applyFont(font: FontSnapshot, language: string): void {
    for (const property of FONT_PROPERTIES) probe.style[property] = font[property];
    if (parseFloat(font.fontSize) === 0) probe.style.fontSize = '16px';
    probe.lang = language;
  }

  function classify(font: FontSnapshot, language: string, cacheKey: string): FontCategory {
    const cached = classificationCache.get(cacheKey);
    if (cached) return cached;
    applyFont(font, language);
    const widths = [];
    // Individual glyphs avoid kerning and ligature artifacts from sample strings.
    for (const character of 'iWm.0l@') {
      probe.textContent = character;
      widths.push(probe.getBoundingClientRect().width);
    }
    const tolerance = Math.max(0.04, parseFloat(font.fontSize) * 0.002);
    const isMono = Math.min(...widths) > 0
      && Math.max(...widths) - Math.min(...widths) <= tolerance;
    let result: FontCategory = isMono ? 'mono' : 'sans';
    if (!isMono) {
      for (const family of splitFamilies(font.fontFamily)) {
        if ((family.generic && ['serif', 'ui-serif', 'fangsong'].includes(family.name))
          || (!family.generic && SERIF_NAMES.has(family.name))) {
          result = 'serif';
          break;
        }
        if ((family.generic && ['sans-serif', 'ui-sans-serif', 'system-ui', 'ui-rounded'].includes(family.name))
          || (!family.generic && SANS_NAMES.has(family.name))) break;
      }
    }
    if (classificationCache.size >= 512) classificationCache.clear();
    classificationCache.set(cacheKey, result);
    return result;
  }

  return {
    host,
    classify,
    applyFont,
    measure(text: string): number {
      probe.textContent = text;
      return probe.getBoundingClientRect().width;
    },
    ensureConnected(): void {
      if (!host.isConnected && document.documentElement) document.documentElement.append(host);
    },
    clearCache(): void {
      classificationCache.clear();
    },
  };
}
