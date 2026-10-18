import { test, expect } from '@playwright/test';
import { setup, start, storage, mockManager, expectFamily, family, changeSetting, chooseMenu, expectSettled } from './helpers';

test('classifies actual mono fonts, declared categories, unknown fonts and missing fonts', async ({ page }) => {
  const { errors } = await setup(page, `
    <style>
      @font-face { font-family: MysteryFace; src: url('/mono.woff2'); }
      p { font-size: 20px; }
    </style>
    <p id="sans" style="font-family: Arial, sans-serif">Text</p>
    <p id="serif" style="font-family: Georgia, serif">Text</p>
    <p id="mono" style="font-family: MysteryFace, sans-serif">iWm.0l@</p>
    <p id="false-mono" style="font-family: Arial, monospace">iWm.0l@</p>
    <p id="missing" style="font-family: MissingFont, monospace">Text</p>
    <p id="unknown" style="font-family: UnknownProportionalFont">Text</p>
    <p id="quoted" style="font-family: 'serif', Arial">Text</p>
    <p id="named" style="font-family: Georgia, sans-serif">Text</p>
  `);
  await expectFamily(page, '#sans', /^sans-serif, Arial, sans-serif$/);
  await expectFamily(page, '#serif', /^serif, Georgia, serif$/);
  await expectFamily(page, '#mono', /^monospace, MysteryFace, sans-serif$/);
  await expectFamily(page, '#false-mono', /^sans-serif, Arial, monospace$/);
  await expectFamily(page, '#missing', /^monospace, MissingFont, monospace$/);
  await expectFamily(page, '#unknown', /^sans-serif, UnknownProportionalFont$/);
  await expectFamily(page, '#quoted', /^sans-serif, "serif", Arial$/);
  await expectFamily(page, '#named', /^serif, Georgia, sans-serif$/);
  await expectSettled(page);
  expect(errors).toEqual([]);
});

test('snapshots inherited fonts before replacement and never grows font stacks', async ({ page }) => {
  await setup(page, `
    <style>#parent { font-family: Georgia, serif; } #parent.changed { font-family: Arial, sans-serif; }</style>
    <div id="parent"><span id="child">Inherited</span><span id="own" style="font-family: monospace">Code</span></div>
  `, { store: storage({ 'fontOverride.serif': '"User Serif"', 'fontOverride.sans': '"User Sans"', 'fontOverride.mono': '"User Mono"' }) });
  await expectFamily(page, '#parent', /^"User Serif", Georgia, serif$/);
  await expectFamily(page, '#child', /^"User Serif", Georgia, serif$/);
  await expectFamily(page, '#own', /^"User Mono", monospace$/);
  for (let i = 0; i < 3; i++) {
    await changeSetting(page, 'serif', `"Serif ${i}"`);
    await expectFamily(page, '#child', new RegExp(`^"Serif ${i}", Georgia, serif$`));
  }
  await page.locator('#parent').evaluate(element => { element.setAttribute('class', 'changed'); });
  await expectFamily(page, '#child', /^"User Sans", Arial, sans-serif$/);
  await expectFamily(page, '#own', /^"User Mono", monospace$/);
  await expectSettled(page);
});

test('tracks inline updates, font shorthand, important priority, and preserves other styles', async ({ page }) => {
  await setup(page, '<p id="target" style="font: italic 20px Georgia; color: red; line-height: 2">Text</p>');
  await expectFamily(page, '#target', /^serif, Georgia$/);
  await page.locator('#target').evaluate(element => {
    element.style.color = 'blue';
    element.style.setProperty('font-family', 'Arial, sans-serif', 'important');
  });
  await expectFamily(page, '#target', /^sans-serif, Arial, sans-serif$/);
  await expect(page.locator('#target')).toHaveCSS('color', 'rgb(0, 0, 255)');
  await expect(page.locator('#target')).toHaveCSS('font-size', '20px');
  await expect(page.locator('#target')).toHaveCSS('font-style', 'italic');
  await expect(page.locator('#target')).toHaveCSS('line-height', '40px');
  await page.locator('#target').evaluate(element => { element.style.font = 'bold 18px monospace'; });
  await expectFamily(page, '#target', /^monospace$/);
  await expect(page.locator('#target')).toHaveCSS('font-weight', '700');
  await expect(page.locator('#target')).toHaveCSS('font-size', '18px');
  await page.locator('#target').evaluate(element => { element.style.removeProperty('font-family'); });
  await expectFamily(page, '#target', /^serif, /);
  await expectSettled(page);
});

test('handles added nodes, text edits, reinsertions, and inherited theme changes', async ({ page }) => {
  await setup(page, `
    <style>body { font-family: Arial, sans-serif; } [data-theme="book"] { font-family: Georgia, serif; }</style>
    <div id="container"><span id="target">Text</span></div>
  `);
  await expectFamily(page, '#target', /^sans-serif, Arial, sans-serif$/);
  await page.locator('#container').evaluate(element => { element.insertAdjacentHTML('beforeend', '<span id="added">More</span>'); });
  await expectFamily(page, '#added', /^sans-serif, Arial, sans-serif$/);
  await page.locator('#container').evaluate(element => { element.setAttribute('data-theme', 'book'); });
  await expectFamily(page, '#added', /^serif, Georgia, serif$/);
  await page.locator('#added').evaluate(element => { element.firstChild!.textContent = '\uE001'; });
  await expectFamily(page, '#added', /^Georgia, serif$/);
  await page.locator('#added').evaluate(element => { element.firstChild!.textContent = 'Plain text again'; });
  await expectFamily(page, '#added', /^serif, Georgia, serif$/);
  await page.locator('#container').evaluate(element => {
    const node = element.querySelector('#added')!;
    node.remove();
    document.body.append(node);
  });
  await expectFamily(page, '#added', /^sans-serif, Arial, sans-serif$/);
});

test('responds to style text, stylesheet load and media-query changes', async ({ page }) => {
  await setup(page, `
    <style id="rules">#target { font-family: Arial, sans-serif; }</style><p id="target">Text</p>
  `);
  await expectFamily(page, '#target', /^sans-serif, Arial, sans-serif$/);
  await page.locator('#rules').evaluate(element => { element.textContent = '#target { font-family: monospace; }'; });
  await expectFamily(page, '#target', /^monospace$/);
  await page.evaluate(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '/late.css'; document.head.append(link);
  });
  await expectFamily(page, '#target', /^serif, Georgia, serif$/);
  await page.locator('#rules').evaluate(element => {
    element.textContent = '@media (max-width: 700px) { #target { font-family: Arial, sans-serif !important; } }';
    document.head.querySelector('link')!.remove();
  });
  await page.setViewportSize({ width: 600, height: 700 });
  await expectFamily(page, '#target', /^sans-serif, Arial, sans-serif$/);
});

test('invalidates width measurements when a late font loads', async ({ page }) => {
  await setup(page, '<p id="target" style="font: 20px DeferredFace, sans-serif">iWm.0l@</p>');
  await expectFamily(page, '#target', /^sans-serif, DeferredFace, sans-serif$/);
  await page.evaluate(async () => {
    const font = new FontFace('DeferredFace', 'url(/mono.woff2)');
    document.fonts.add(font);
    await font.load();
    await document.fonts.ready;
  });
  await expectFamily(page, '#target', /^monospace, DeferredFace, sans-serif$/);
  await expectSettled(page);
});

test('preserves rendered icon ligatures, PUA icons, pseudo icons and math/SVG boundaries', async ({ page }) => {
  await setup(page, `
    <style>
      @font-face { font-family: 'Material Icons'; src: url('/icons.woff2'); }
      body { font: 20px Arial, sans-serif; }
      .material-icons { font: 32px 'Material Icons'; font-feature-settings: 'liga'; }
      #pseudo::before { content: 'home'; font: 32px 'Material Icons'; font-feature-settings: 'liga'; }
      #inherited::before { content: '\\e001'; }
    </style>
    <div id="parent"><span id="icon" class="material-icons">home</span>
      <span id="pua">&#xe001;</span><span id="pseudo"></span><span id="inherited"></span>
      <span id="math" class="katex"><span id="formula">x² + y²</span></span>
      <svg id="svg" width="120" height="40"><text id="svg-text" y="30">Vector</text></svg>
      <math id="mathml"><mi id="mi">x</mi></math>
    </div>
  `, { inject: false, store: storage({ 'fontOverride.sans': 'monospace' }) });
  await page.evaluate(() => document.fonts.ready);
  const iconBefore = await page.locator('#icon').screenshot();
  const protectedSelectors = ['#pua', '#math', '#formula', '#svg', '#svg-text', '#mathml', '#mi', '#inherited'];
  const before = await Promise.all(protectedSelectors.map(selector => family(page, selector)));
  await start(page);
  await expectFamily(page, '#parent', /^monospace, Arial, sans-serif$/);
  await expectSettled(page);
  expect((await page.locator('#icon').screenshot()).equals(iconBefore), 'icon pixels are unchanged').toBe(true);
  expect(await Promise.all(protectedSelectors.map(selector => family(page, selector)))).toEqual(before);
  expect(await page.locator('#pseudo').evaluate(element => getComputedStyle(element, '::before').fontFamily)).toBe('"Material Icons"');
  expect(await page.locator('#inherited').evaluate(element => getComputedStyle(element, '::before').fontFamily)).toBe(before.at(-1));
});

test('releases old overrides when a subtree becomes a protected formula', async ({ page }) => {
  await setup(page, '<div id="parent" style="font-family: Arial, sans-serif"><span id="child">x</span></div>');
  await expectFamily(page, '#child', /^sans-serif, Arial, sans-serif$/);
  await page.locator('#parent').evaluate(element => { element.setAttribute('class', 'katex'); });
  await expectFamily(page, '#parent', /^Arial, sans-serif$/);
  await expectFamily(page, '#child', /^Arial, sans-serif$/);
  expect(await page.locator('#child').evaluate(element => element.style.fontFamily)).toBe('');
  await page.locator('#parent').evaluate(element => { element.setAttribute('class', ''); });
  await expectFamily(page, '#child', /^sans-serif, Arial, sans-serif$/);
});

test('offers exactly three settings and validates CSS family lists without changing cancelled values', async ({ page }) => {
  const { store } = await setup(page, '<p id="target" style="font-family: Arial, sans-serif">Text</p>');
  expect(await page.evaluate(() => Object.keys(window.__menus))).toEqual(['设置 sans 字体', '设置 serif 字体', '设置 mono 字体']);
  await chooseMenu(page, 'sans', '"Family, With Comma", "PingFang SC"');
  await expectFamily(page, '#target', /^"Family, With Comma", "PingFang SC", Arial, sans-serif$/);
  await chooseMenu(page, 'sans', null);
  expect(store.values['fontOverride.sans']).toBe('"Family, With Comma", "PingFang SC"');
  for (const invalid of ['Arial; color: red', 'inherit', 'var(--font)', 'Arial,', '"unclosed']) {
    const dialogs = await chooseMenu(page, 'sans', invalid);
    expect(dialogs.map(dialog => dialog.type), invalid).toEqual(['prompt', 'alert']);
  }
  expect(await page.evaluate(() => window.__writes.length)).toBe(1);
  await chooseMenu(page, 'sans', '   ');
  await expectFamily(page, '#target', /^sans-serif, Arial, sans-serif$/);
  expect(store.values['fontOverride.sans']).toBe('sans-serif');
});

test('synchronizes settings across pages and loads saved settings in later pages', async ({ context, page }) => {
  const store = storage();
  const html = '<p id="target" style="font-family: Arial, sans-serif">Text</p>';
  await setup(page, html, { store });
  const second = await context.newPage();
  await setup(second, html, { store });
  await chooseMenu(page, 'sans', '"Preferred Sans"');
  await expectFamily(second, '#target', /^"Preferred Sans", Arial, sans-serif$/);
  const third = await context.newPage();
  await setup(third, html, { store });
  await expectFamily(third, '#target', /^"Preferred Sans", Arial, sans-serif$/);
  await chooseMenu(second, 'serif', '"Preferred Serif"');
  expect(store.values['fontOverride.sans']).toBe('"Preferred Sans"');
  expect(store.values['fontOverride.serif']).toBe('"Preferred Serif"');
});

test('runs in an injected iframe without duplicate menus', async ({ page }) => {
  await setup(page, '<iframe srcdoc="<p id=target style=font-family:monospace>code</p>"></iframe>');
  const frame = page.frames().find(candidate => candidate !== page.mainFrame());
  if (!frame) throw new Error('Fixture iframe not found.');
  await mockManager(frame, { 'fontOverride.mono': '"Frame Mono"' });
  await start(frame);
  await expectFamily(frame, '#target', /^"Frame Mono", monospace$/);
  expect(await frame.evaluate(() => Object.keys(window.__menus))).toEqual([]);
});

test('preserves a sole generic font without adding a duplicate and supports setTimeout scheduling', async ({ page }) => {
  await setup(page, '<code id="code">Code</code><p id="sans" style="font-family:sans-serif">Text</p>', { inject: false, noIdle: true });
  const size = await page.locator('#code').evaluate(element => getComputedStyle(element).fontSize);
  await start(page);
  await expectFamily(page, '#code', /^monospace$/);
  await expectFamily(page, '#sans', /^sans-serif$/);
  await expect(page.locator('#code')).toHaveCSS('font-size', size);
  await expectSettled(page);
});

test('batches a large document, caches shared measurements and becomes idle', async ({ page }) => {
  const paragraphs = Array.from({ length: 2_000 }, (_, i) => `<span id="item-${i}">Text ${i}</span>`).join('');
  const { errors } = await setup(page, `<main style="font: 20px Arial, sans-serif">${paragraphs}</main>`);
  await expectFamily(page, '#item-1999', /^sans-serif, Arial, sans-serif$/);
  await expectSettled(page);
  const metrics = await page.evaluate(() => window.__metrics);
  expect(metrics.tasks).toBeGreaterThan(2);
  expect(metrics.measurements).toBeLessThan(150);
  expect(metrics.observers).toBeLessThan(10);
  expect(errors).toEqual([]);
});

test('falls back for a missing preferred font and glyphs outside a preferred face subset', async ({ page }) => {
  await setup(page, `
    <style>
      @font-face { font-family: LimitedFace; src: url('/mono.woff2'); unicode-range: U+0030-0039; }
      p { display: inline-block; font: 24px Arial, sans-serif; }
    </style>
    <p id="letters">WWWiii Latin text</p><p id="digits">000111</p>
  `, { inject: false });
  await page.evaluate(() => document.fonts.load('24px LimitedFace', '0'));
  const textWidth = (selector: string) => page.locator(selector).evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().width;
  });
  const lettersBefore = await page.locator('#letters').screenshot();
  const lettersWidth = await textWidth('#letters');
  const digitsWidth = await textWidth('#digits');
  await start(page);
  await changeSetting(page, 'sans', 'DefinitelyNotAnInstalledFont');
  await expectFamily(page, '#letters', /^DefinitelyNotAnInstalledFont, Arial, sans-serif$/);
  expect((await page.locator('#letters').screenshot()).equals(lettersBefore)).toBe(true);
  await changeSetting(page, 'sans', 'LimitedFace');
  await expectFamily(page, '#letters', /^LimitedFace, Arial, sans-serif$/);
  // A new first face may change line-box metrics even for fallback glyphs.
  // Compare glyph advances, not vertical placement of an inline-block screenshot.
  expect(await textWidth('#letters')).toBeCloseTo(lettersWidth, 4);
  expect(await textWidth('#digits')).not.toBeCloseTo(digitsWidth, 1);
});

test('measures hidden zero-size mono text and survives a web font load failure', async ({ page }) => {
  const { errors } = await setup(page, '<p id="target" style="font: 0px MysteryFace, monospace">code</p>', {
    store: storage({ 'fontOverride.mono': '"Chosen Mono"' }),
  });
  await expectFamily(page, '#target', /^"Chosen Mono", MysteryFace, monospace$/);
  await page.evaluate(async () => {
    const font = new FontFace('MysteryFace', new Uint8Array([0, 1, 2, 3]));
    document.fonts.add(font);
    await font.load().catch(() => {});
  });
  await expectSettled(page);
  await expectFamily(page, '#target', /^"Chosen Mono", MysteryFace, monospace$/);
  await expect(page.locator('#target')).toHaveCSS('font-size', '0px');
  expect(errors).toEqual([]);
});
