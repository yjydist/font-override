import { expect, type Frame, type Page } from '@playwright/test';

const script = await Bun.file(new URL('../dist/font-override.user.js', import.meta.url)).text();
const monoFont = Buffer.from(await Bun.file(new URL('../node_modules/@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff2', import.meta.url)).arrayBuffer());
const proportionalFont = Buffer.from(await Bun.file(new URL('../node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff2', import.meta.url)).arrayBuffer());
const iconFont = Buffer.from(await Bun.file(new URL('../node_modules/@fontsource/material-icons/files/material-icons-latin-400-normal.woff2', import.meta.url)).arrayBuffer());
const testFonts: Record<string, Buffer> = {
  '/mono.woff2': monoFont,
  '/proportional.woff2': proportionalFont,
  '/icons.woff2': iconFont,
};

export interface SetupOptions {
  head?: string;
  inject?: boolean;
  slowScript?: boolean;
  afterInject?: () => void;
}

export async function setup(page: Page, html: string, { head = '', inject = true, slowScript = false, afterInject }: SetupOptions = {}) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://font-override.test/**', async route => {
    const url = new URL(route.request().url());
    if (testFonts[url.pathname]) {
      await route.fulfill({ contentType: 'font/woff2', body: testFonts[url.pathname] });
    } else if (url.pathname === '/late.css' || url.pathname === '/late-mono.css') {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 50);
      await promise;
      await route.fulfill({
        contentType: 'text/css',
        body: url.pathname === '/late-mono.css'
          ? '#target { font-family: monospace; }'
          : '#target { font-family: Georgia, serif !important; }',
      });
    } else if (url.pathname === '/slow-print.css') {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 300);
      await promise;
      await route.fulfill({ contentType: 'text/css', body: 'body { color: inherit; }' });
    } else if (url.pathname === '/slow.js') {
      if (slowScript) {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 300);
        await promise;
      }
      await route.fulfill({ contentType: 'text/javascript', body: 'window.__slowRan = performance.now();' });
    } else {
      await route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${html}</body></html>`,
      });
    }
  });
  // Metrics must exist before the userscript performs its first synchronous pass.
  await page.addInitScript(installMetrics);
  if (inject) await page.addInitScript({ content: script });
  if (afterInject) await page.addInitScript(afterInject);
  await page.goto('http://font-override.test/');
  return { errors };
}

function installMetrics() {
  window.__metrics = { measurements: 0, writes: 0, boundaryMeasurements: 0, boundaryWrites: 0, pseudoReads: 0 };
  const boundary = '.katex, .mwe-math-element, .MathJax, mjx-container, svg, math';
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element, ...args: Parameters<typeof rect>) {
    if (this.getRootNode() instanceof ShadowRoot) window.__metrics.measurements++;
    return rect.apply(this, args);
  };
  const computedStyle = window.getComputedStyle;
  window.getComputedStyle = (element: Element, pseudo?: string | null) => {
    if (pseudo) window.__metrics.pseudoReads++;
    const owner = element.closest(boundary);
    // Reading the boundary itself is allowed; only its descendants must be pruned.
    if (owner && owner !== element) window.__metrics.boundaryMeasurements++;
    return computedStyle.call(window, element, pseudo);
  };
  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (this: CSSStyleDeclaration, ...args: Parameters<typeof setProperty>) {
    if (args[0] === 'font-family') window.__metrics.writes++;
    return setProperty.apply(this, args);
  };
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes' && record.attributeName === 'style'
        && record.target instanceof Element && record.target.parentElement?.closest(boundary)) {
        window.__metrics.boundaryWrites++;
      }
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style'] });
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

/** Resolve the computed family in the first frame after the current task. */
export async function nextFrameFamily(page: Page, selector: string) {
  return page.evaluate(async selector => {
    await new Promise(requestAnimationFrame);
    const element = document.querySelector(selector);
    return element ? getComputedStyle(element).fontFamily : null;
  }, selector);
}
