import { expect, type Dialog, type Frame, type Page } from '@playwright/test';
import type { FontCategory } from '../src/types';
import type { ValueChangeListener } from '../src/userscript';

const script = await Bun.file(new URL('../dist/font-override.user.js', import.meta.url)).text();
const monoFont = Buffer.from(await Bun.file(new URL('../node_modules/@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff2', import.meta.url)).arrayBuffer());
const iconFont = Buffer.from(await Bun.file(new URL('../node_modules/@fontsource/material-icons/files/material-icons-latin-400-normal.woff2', import.meta.url)).arrayBuffer());

export function storage(initial: Record<string, unknown> = {}) {
  return { values: { ...initial }, pages: new Set<Page>() };
}

export async function setup(page: Page, html: string, { store = storage(), noIdle = false, inject = true }: { store?: ReturnType<typeof storage>; noIdle?: boolean; inject?: boolean } = {}) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://font-override.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/mono.woff2' || url.pathname === '/icons.woff2') {
      await route.fulfill({ contentType: 'font/woff2', body: url.pathname === '/mono.woff2' ? monoFont : iconFont });
    } else if (url.pathname === '/late.css') {
      await route.fulfill({ contentType: 'text/css', body: '#target { font-family: Georgia, serif !important; }' });
    } else {
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${html}</body></html>` });
    }
  });
  await page.goto('http://font-override.test/');
  store.pages.add(page);
  await page.exposeFunction('__persistFontSetting', async (key: string, value: unknown) => {
    store.values[key] = value;
    await Promise.all([...store.pages].filter(other => other !== page && !other.isClosed()).map(other =>
      other.evaluate(({ key, value }) => window.__deliverSetting(key, value, true), { key, value })));
  });
  await mockManager(page, store.values, noIdle);
  if (inject) await start(page);
  return { errors, store };
}

export async function mockManager(target: Page | Frame, values: Record<string, unknown> = {}, noIdle = false) {
  await target.evaluate(({ values, noIdle }) => {
    window.__menus = {};
    window.__writes = [];
    window.__metrics = { observers: 0, tasks: 0, measurements: 0, writes: 0 };
    const listeners = new Map<string, ValueChangeListener[]>();
    let listenerId = 0;
    window.__deliverSetting = (key, value, remote) => {
      const old = values[key];
      values[key] = value;
      for (const listener of listeners.get(key) || []) listener(key, old, value, remote);
    };
    window.GM_getValue = (key, fallback) => values[key] ?? fallback;
    window.GM_setValue = (key, value) => {
      window.__writes.push({ key, value });
      window.__deliverSetting(key, value, false);
      window.__persistFontSetting?.(key, value);
    };
    window.GM_addValueChangeListener = (key, callback) => {
      listeners.set(key, [...(listeners.get(key) || []), callback]);
      return ++listenerId;
    };
    window.GM_registerMenuCommand = (label, callback) => { window.__menus[label] = callback; return label; };
    const NativeObserver = window.MutationObserver;
    window.MutationObserver = class extends NativeObserver {
      constructor(callback: MutationCallback) {
        super((...args) => { window.__metrics.observers++; callback(...args); });
      }
    };
    const rect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element, ...args: Parameters<typeof rect>) {
      if (this.getRootNode() instanceof ShadowRoot) window.__metrics.measurements++;
      return rect.apply(this, args);
    };
    const setProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (this: CSSStyleDeclaration, ...args: Parameters<typeof setProperty>) {
      if (args[0] === 'font-family') window.__metrics.writes++;
      return setProperty.apply(this, args);
    };
    if (noIdle) Object.defineProperty(window, 'requestIdleCallback', { value: undefined, configurable: true });
    else {
      const idle = window.requestIdleCallback.bind(window);
      window.requestIdleCallback = (callback, options) => idle(deadline => {
        window.__metrics.tasks++;
        callback(deadline);
      }, options);
    }
  }, { values, noIdle });
}

export async function start(target: Page | Frame) {
  await target.addScriptTag({ content: script });
}

export async function family(page: Page | Frame, selector: string) {
  return page.locator(selector).evaluate(element => getComputedStyle(element).fontFamily);
}

export async function expectFamily(page: Page | Frame, selector: string, pattern: RegExp) {
  await expect.poll(() => family(page, selector)).toMatch(pattern);
}

export async function changeSetting(page: Page, category: FontCategory, value: string) {
  await page.evaluate(({ category, value }) => {
    window.GM_setValue(`fontOverride.${category}`, value);
  }, { category, value });
}

export async function chooseMenu(page: Page, category: FontCategory, answer: string | null) {
  const dialogs: { type: string; message: string }[] = [];
  const onDialog = async (dialog: Dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    if (dialog.type() === 'prompt') {
      if (answer === null) await dialog.dismiss();
      else await dialog.accept(answer);
    } else await dialog.accept();
  };
  page.on('dialog', onDialog);
  await page.evaluate(category => window.__menus[`设置 ${category} 字体`](), category);
  page.off('dialog', onDialog);
  return dialogs;
}

export async function expectSettled(page: Page) {
  // This observes a quiet interval, not a guessed time for a specific DOM update.
  let previous: string | undefined;
  let stable = 0;
  await expect.poll(async () => {
    const current = JSON.stringify(await page.evaluate(() => window.__metrics));
    stable = current === previous ? stable + 1 : 0;
    previous = current;
    return stable;
  }, { intervals: [150, 150, 150, 150], timeout: 15_000 }).toBeGreaterThanOrEqual(3);
}
