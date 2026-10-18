import { splitFamilies } from './font-families';
import { CATEGORIES, type FontCategory, type FontSettings } from './types';

export const DEFAULTS: Readonly<FontSettings> = Object.freeze({ sans: 'sans-serif', serif: 'serif', mono: 'monospace' });
const STORAGE_PREFIX = 'fontOverride.';

export function initializeSettings(settings: FontSettings, onChange: () => void): void {
  const validator = document.createElement('span').style;

  function normalizeSetting(value: unknown, category: FontCategory): string | null {
    if (typeof value !== 'string') return null;
    if (!value.trim()) return DEFAULTS[category];
    // CSS parsing repairs some errors (notably an unclosed string at EOF).
    // Reject those before asking CSSOM to validate and serialize the declaration.
    if (!splitFamilies(value.trim()).length) return null;
    validator.fontFamily = '';
    validator.fontFamily = value.trim();
    const normalized = validator.fontFamily;
    const parts = splitFamilies(normalized);
    if (!normalized || !parts.length || parts.some(({ raw }) =>
      /^(?:inherit|initial|unset|revert|revert-layer)$/i.test(raw)
      || (!/^["']/.test(raw) && /[()]/.test(raw)))) return null;
    return normalized;
  }

  function acceptSetting(category: FontCategory, value: unknown): void {
    const normalized = normalizeSetting(value, category) ?? DEFAULTS[category];
    if (settings[category] === normalized) return;
    settings[category] = normalized;
    onChange();
  }

  for (const category of CATEGORIES) {
    const key = STORAGE_PREFIX + category;
    settings[category] = normalizeSetting(GM_getValue(key, DEFAULTS[category]), category)
      ?? DEFAULTS[category];
    GM_addValueChangeListener(key, (_key, _old, value) => acceptSetting(category, value));
    if (window.top === window.self) {
      GM_registerMenuCommand(`设置 ${category} 字体`, () => {
        const answer = window.prompt(
          `设置 ${category} 字体\n可填写字体名称或逗号分隔的字体列表；留空恢复 ${DEFAULTS[category]}。\n只使用本机或网页已提供的字体。`,
          settings[category],
        );
        if (answer === null) return;
        const value = normalizeSetting(answer, category);
        if (value === null) {
          window.alert('字体设置无效。请输入字体名称或字体列表，例如："Inter", "PingFang SC"。');
          return;
        }
        GM_setValue(key, value);
        acceptSetting(category, value);
      });
    }
  }
}
