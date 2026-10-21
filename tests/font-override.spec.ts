import { test, expect } from '@playwright/test';
import { setup, start, expectFamily, family, nextFrameFamily } from './helpers';

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
  expect(errors).toEqual([]);
});

test('skips inherited elements and never grows font stacks across rescans', async ({ page }) => {
  await setup(page, `
    <style>#parent { font-family: Georgia, serif; } #parent.changed { font-family: Arial, sans-serif; }</style>
    <div id="parent"><span id="child">Inherited</span><span id="own" style="font-family: monospace">Code<span id="own-child">Nested</span></span><span id="same-inline" style="font-family: Georgia, serif">Same</span></div>
  `);
  await expectFamily(page, '#parent', /^serif, Georgia, serif$/);
  await expectFamily(page, '#child', /^serif, Georgia, serif$/);
  await expectFamily(page, '#own', /^monospace$/);
  await expectFamily(page, '#same-inline', /^serif, Georgia, serif$/);
  expect(await page.locator('#same-inline').evaluate(element => element.style.fontFamily)).toBe('serif, Georgia, serif');
  for (let i = 0; i < 4; i++) {
    await page.locator('#parent').evaluate(element => element.classList.toggle('changed'));
    await expectFamily(page, '#parent', i % 2 === 0 ? /^sans-serif, Arial, sans-serif$/ : /^serif, Georgia, serif$/);
    const stack = await page.locator('#parent').evaluate(element => element.style.fontFamily);
    expect(stack.split(',').length).toBeLessThanOrEqual(3);
  }
  expect(await page.locator('#child').evaluate(element => element.style.fontFamily)).toBe('');
  expect(await page.locator('#own').evaluate(element => element.style.fontFamily)).toBe('monospace');
  await expectFamily(page, '#own-child', /^monospace$/);
  expect(await page.locator('#own-child').evaluate(element => element.style.fontFamily)).toBe('');
});

test('processes a stylesheet rule equal to the inherited family after the parent is written', async ({ page }) => {
  await setup(page, `
    <style>body { font-family: Arial, sans-serif; } #target { font-family: Arial, sans-serif; }</style>
    <div><span id="target">Text</span></div>
  `);
  await expectFamily(page, '#target', /^sans-serif, Arial, sans-serif$/);
  expect(await page.locator('#target').evaluate(element => element.style.fontFamily)).toBe('sans-serif, Arial, sans-serif');
  // The wrapper only inherits; only the own stylesheet rule is replaced.
  expect(await page.locator('#target').evaluate(element => element.parentElement!.getAttribute('style'))).toBe(null);
});

test('settles after its own writes without scheduling another scan', async ({ page }) => {
  await setup(page, `
    <style>#parent { font-family: Georgia, serif; } #parent.changed { font-family: Arial, sans-serif; }</style>
    <div id="parent"><span id="child">Inherited</span></div>
  `);
  await expectFamily(page, '#parent', /^serif, Georgia, serif$/);
  await page.locator('#parent').evaluate(element => { element.classList.add('changed'); });
  await expectFamily(page, '#parent', /^sans-serif, Arial, sans-serif$/);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const settled = await page.evaluate(() => window.__metrics);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__metrics)).toEqual(settled);
  expect(await page.locator('#child').evaluate(element => element.style.fontFamily)).toBe('');
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

test('responds to lang attribute changes', async ({ page }) => {
  await setup(page, `
    <style>body { font: 20px Arial, sans-serif; } p:lang(zh) { font-family: Georgia, serif; }</style>
    <p id="target" lang="en">Text</p>
  `);
  await expectFamily(page, '#target', /^sans-serif, Arial, sans-serif$/);
  await page.locator('#target').evaluate(element => element.setAttribute('lang', 'zh'));
  await expectFamily(page, '#target', /^serif, Georgia, serif$/);
  await page.locator('#target').evaluate(element => element.setAttribute('lang', 'en'));
  await expectFamily(page, '#target', /^sans-serif, Arial, sans-serif$/);
  expect(await page.locator('#target').evaluate(element => element.style.fontFamily)).toBe('');
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
    link.rel = 'stylesheet';
    link.href = '/late.css';
    document.head.append(link);
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
  const settled = await page.locator('#target').evaluate(element => getComputedStyle(element).fontFamily);
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.dispatchEvent(new Event('resize'));
  });
  expect(await page.locator('#target').evaluate(element => getComputedStyle(element).fontFamily)).toBe(settled);
  expect(settled.split(',').length).toBe(3);
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
  `, { inject: false });
  await page.evaluate(() => document.fonts.ready);
  const iconBefore = await page.locator('#icon').screenshot();
  const protectedSelectors = ['#pua', '#math', '#formula', '#svg', '#svg-text', '#mathml', '#mi', '#inherited'];
  const before = await Promise.all(protectedSelectors.map(selector => family(page, selector)));
  await start(page);
  await expectFamily(page, '#parent', /^sans-serif, Arial, sans-serif$/);
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

test('preserves encrypted font names and marked subtrees without exempting ordinary web fonts', async ({ page }) => {
  const { errors } = await setup(page, `
    <style>
      @font-face { font-family: 'EXAM-DATA-DECRYPT-FONT'; src: url('/icons.woff2'); }
      @font-face { font-family: EncodedFace; src: url('/icons.woff2'); }
      @font-face { font-family: OrdinaryFace; src: url('/mono.woff2'); }
      body { font: 20px Arial, sans-serif; }
      .sample { display: block; width: 100px; height: 48px; font-size: 32px; }
      #named { font-family: 'EXAM-DATA-DECRYPT-FONT', Arial, sans-serif; }
      #marked { font-family: EncodedFace, Arial, sans-serif; }
    </style>
    <div id="parent">
      <span id="named" class="sample">home</span>
      <span id="marked" class="sample xuetangx-com-encrypted-font"><b id="nested">home</b></span>
      <p id="chinese" style="font-family: exam-data-decrypt-font, Arial">步也灯</p>
      <p id="ordinary" style="font-family: OrdinaryFace, sans-serif">iWm.0l@</p>
      <p id="similar" style="font-family: other-exam-data-decrypt-font, Arial">Text</p>
      <p id="comma" style="font-family: 'exam-data-decrypt-font, decoy', Arial">Text</p>
    </div>
  `, { inject: false });
  await page.evaluate(() => document.fonts.ready);
  const selectors = ['#named', '#marked', '#nested', '#chinese'];
  const before = await Promise.all(selectors.map(selector => family(page, selector)));
  const screenshots = await Promise.all(['#named', '#marked'].map(selector => page.locator(selector).screenshot()));
  await start(page);
  await expectFamily(page, '#parent', /^sans-serif, Arial, sans-serif$/);
  await expectFamily(page, '#ordinary', /^monospace, OrdinaryFace, sans-serif$/);
  expect(await Promise.all(selectors.map(selector => family(page, selector)))).toEqual(before);
  for (const [index, selector] of ['#named', '#marked'].entries()) {
    expect((await page.locator(selector).screenshot()).equals(screenshots[index]!), `${selector} glyphs are unchanged`).toBe(true);
  }
  await expect(page.locator('#chinese')).toHaveText('步也灯');
  await expectFamily(page, '#similar', /^sans-serif, other-exam-data-decrypt-font, Arial$/);
  await expectFamily(page, '#comma', /^sans-serif, "exam-data-decrypt-font, decoy", Arial$/);
  expect(errors).toEqual([]);
});

test('restores encrypted subtree declarations and resumes replacement when unmarked', async ({ page }) => {
  await setup(page, `
    <style>body { font-family: Arial, sans-serif; }</style>
    <div id="parent"><section id="boundary">
      ${'<span class="inherited">文字</span>'.repeat(90)}
      <span id="own" style="font-family: Georgia, serif !important; color: red">自有字体</span>
    </section></div>
  `);
  await expectFamily(page, '#own', /^serif, Georgia, serif$/);
  await page.locator('#boundary').evaluate(element => { element.classList.add('xuetangx-com-encrypted-font'); });
  await expectFamily(page, '#boundary', /^Arial, sans-serif$/);
  await expectFamily(page, '#own', /^Georgia, serif$/);
  expect(await page.locator('.inherited').evaluateAll(elements => elements.every(element =>
    getComputedStyle(element).fontFamily === 'Arial, sans-serif' && element.getAttribute('style')?.includes('font-family') !== true))).toBe(true);
  expect(await page.locator('#own').evaluate(element => ({ value: element.style.fontFamily, priority: element.style.getPropertyPriority('font-family') })))
    .toEqual({ value: 'Georgia, serif', priority: 'important' });
  await expect(page.locator('#own')).toHaveCSS('color', 'rgb(255, 0, 0)');
  await page.locator('#boundary').evaluate(element => { element.insertAdjacentHTML('beforeend', '<span id="added">动态题目</span>'); });
  await expectFamily(page, '#added', /^Arial, sans-serif$/);
  // An unrelated rescan must not touch protected content.
  await page.locator('#parent').evaluate(element => { element.classList.toggle('unrelated'); });
  await expectFamily(page, '#added', /^Arial, sans-serif$/);
  await page.locator('#boundary').evaluate(element => { element.classList.remove('xuetangx-com-encrypted-font'); });
  await expectFamily(page, '#added', /^sans-serif, Arial, sans-serif$/);
  await expectFamily(page, '#own', /^serif, Georgia, serif$/);
});

test('protects dynamically assigned encrypted fonts before and after font loading', async ({ page }) => {
  await setup(page, '<div style="font-family: Arial, sans-serif"><p id="target">iWm.0l@</p></div>');
  await expectFamily(page, '#target', /^sans-serif, Arial, sans-serif$/);
  await page.locator('#target').evaluate(element => { element.style.fontFamily = 'exam-data-decrypt-font, Arial'; });
  await expectFamily(page, '#target', /^exam-data-decrypt-font, Arial$/);
  await page.evaluate(async () => {
    const font = new FontFace('exam-data-decrypt-font', 'url(/mono.woff2)');
    document.fonts.add(font);
    await font.load();
    await document.fonts.ready;
  });
  await expectFamily(page, '#target', /^exam-data-decrypt-font, Arial$/);
  await page.locator('#target').evaluate(element => { element.style.fontFamily = 'Arial, sans-serif'; });
  await expectFamily(page, '#target', /^sans-serif, Arial, sans-serif$/);
});

test('protects encrypted content inside an injected iframe while replacing ordinary text', async ({ page }) => {
  await setup(page, `<iframe srcdoc='<style>body { font-family: Arial, sans-serif; }</style>
    <p id="named" style="font-family: exam-data-decrypt-font, Arial">步也灯</p>
    <div class="xuetangx-com-encrypted-font"><span id="nested">文字</span></div>
    <p id="ordinary">普通文字</p>'></iframe>`);
  const frame = page.frames().find(candidate => candidate !== page.mainFrame());
  if (!frame) throw new Error('Fixture iframe not found.');
  await expectFamily(frame, '#ordinary', /^sans-serif, Arial, sans-serif$/);
  await expectFamily(frame, '#named', /^exam-data-decrypt-font, Arial$/);
  await expectFamily(frame, '#nested', /^Arial, sans-serif$/);
});

test('preserves a sole generic font without adding a duplicate declaration', async ({ page }) => {
  await setup(page, '<code id="code">Code</code><p id="sans" style="font-family:sans-serif">Text</p><p id="dup" style="font-family: serif, Georgia, serif">Text</p>');
  await expectFamily(page, '#code', /^monospace$/);
  await expectFamily(page, '#sans', /^sans-serif$/);
  await expectFamily(page, '#dup', /^serif, Georgia, serif$/);
  expect(await page.locator('#sans').evaluate(element => element.style.fontFamily)).toBe('sans-serif');
  expect(await page.locator('#dup').evaluate(element => element.style.fontFamily)).toBe('serif, Georgia, serif');
});

test('scans a large document once per independent declaration and caches measurements', async ({ page }) => {
  const paragraphs = Array.from({ length: 2_000 }, (_, i) => `<span class="item" id="item-${i}">Text ${i}</span>`).join('');
  const { errors } = await setup(page, `<main style="font: 20px Arial, sans-serif">${paragraphs}</main>`);
  await expectFamily(page, '#item-1999', /^sans-serif, Arial, sans-serif$/);
  const metrics = await page.evaluate(() => window.__metrics);
  // Chunked parsing rescans the shared ancestor once per chunk; inherited spans add nothing.
  expect(metrics.writes).toBeLessThanOrEqual(10);
  expect(metrics.measurements).toBeLessThan(100);
  expect(await page.locator('.item').evaluateAll(elements =>
    elements.filter(element => (element.getAttribute('style') || '').includes('font-family')).length)).toBe(0);
  expect(errors).toEqual([]);
});

test('measures hidden zero-size mono text and survives a web font load failure', async ({ page }) => {
  const { errors } = await setup(page, '<p id="target" style="font: 0px MysteryFace, monospace">code</p>');
  await expectFamily(page, '#target', /^monospace, MysteryFace, monospace$/);
  await page.evaluate(async () => {
    const font = new FontFace('MysteryFace', new Uint8Array([0, 1, 2, 3]));
    document.fonts.add(font);
    await font.load().catch(() => {});
  });
  await expectFamily(page, '#target', /^monospace, MysteryFace, monospace$/);
  await expect(page.locator('#target')).toHaveCSS('font-size', '0px');
  expect(errors).toEqual([]);
});

test('isolates a failing element without aborting the rest or throwing', async ({ page }) => {
  const { errors } = await setup(page, `
    <style>#fine, #broken { font-family: Georgia, serif; }</style>
    <p id="fine">Text</p><p id="broken">Text</p>
  `, { inject: false });
  await page.evaluate(() => {
    const original = window.getComputedStyle.bind(window);
    window.__originalGetComputedStyle = original;
    window.getComputedStyle = (element: Element, pseudo?: string | null) => {
      if (element.id === 'broken') throw new Error('computed style unavailable');
      return original(element, pseudo);
    };
  });
  await start(page);
  await expectFamily(page, '#fine', /^serif, Georgia, serif$/);
  expect(await page.locator('#broken').evaluate(element => {
    const original = window.__originalGetComputedStyle!;
    return { inline: element.style.fontFamily, computed: original(element).fontFamily };
  })).toEqual({ inline: '', computed: 'Georgia, serif' });
  expect(errors).toEqual([]);
});

test('protects extended math font names and formula containers', async ({ page }) => {
  const faces = ['Latin Modern Math', 'STIX', 'STIX Two Math', 'STIXGeneral', 'STIXSizeOneSym', 'XITS Math', 'TeX Gyre Pagella Math', 'Asana Math',
    'Noto Sans Math', 'Noto Serif Math', 'Noto Math', 'Libertinus Math', 'Fira Math', 'Garamond Math'];
  await setup(page, `
    <style>
      body { font: 20px Arial, sans-serif; }
      ${faces.map((face, index) => `.face-${index} { font-family: '${face}', serif; }`).join('\n')}
    </style>
    <div id="parent">${faces.map((_, index) => `<span class="face-${index}" id="face-${index}">x</span>`).join('')}
      <span id="mwe" class="mwe-math-element"><b id="mwe-inner">y</b></span>
      <span id="math-container" class="math">z</span>
      <span id="formula" class="formula">f</span>
      <span id="equation" class="equation">e</span>
    </div>
  `, { inject: false });
  const selectors = [...faces.map((_, index) => `#face-${index}`),
    '#mwe', '#mwe-inner', '#math-container', '#formula', '#equation'];
  const before = await Promise.all(selectors.map(selector => family(page, selector)));
  await start(page);
  await expectFamily(page, '#parent', /^sans-serif, Arial, sans-serif$/);
  expect(await Promise.all(selectors.map(selector => family(page, selector)))).toEqual(before);
  expect(await page.evaluate(() => window.__metrics.boundaryWrites)).toBe(0);
});

test('recognises unknown ligature icon fonts by glyph width ratio', async ({ page }) => {
  await setup(page, `
    <style>
      @font-face { font-family: MysteryIcons; src: url('/icons.woff2'); }
      @font-face { font-family: 'Roboto Mono Test'; src: url('/mono.woff2'); }
      @font-face { font-family: 'Proportional Test'; src: url('/proportional.woff2'); }
      body { font: 20px Arial, sans-serif; }
      #icon { font: 32px MysteryIcons, sans-serif; font-feature-settings: 'liga'; }
      #mono { font-family: 'Roboto Mono Test', sans-serif; }
      #proportional { font-family: 'Proportional Test', sans-serif; }
    </style>
    <p id="icon">home</p><p id="mono">iWm.0l@</p><p id="proportional">iWm.0l@</p>
  `, { inject: false });
  await page.evaluate(() => document.fonts.ready);
  await start(page);
  await expectFamily(page, '#icon', /^MysteryIcons, sans-serif$/);
  await expectFamily(page, '#mono', /^monospace, "Roboto Mono Test", sans-serif$/);
  // A web font with matching glyph and character widths is not an icon font.
  await expectFamily(page, '#proportional', /^sans-serif, "Proportional Test", sans-serif$/);
});

test('refreshes the web font set when one face replaces another of equal count', async ({ page }) => {
  await setup(page, `
    <style>
      body { font: 20px Arial, sans-serif; }
      #icon { font: 32px MysteryIcons, sans-serif; font-feature-settings: 'liga'; }
    </style>
    <p id="icon">home</p>
  `, { inject: false });
  await page.evaluate(async () => {
    window.__placeholder = new FontFace('PlaceholderFace', 'local(Arial)');
    document.fonts.add(window.__placeholder);
    window.__icon = await new FontFace('MysteryIcons', 'url(/icons.woff2)').load();
    await document.fonts.ready;
  });
  await start(page);
  await expectFamily(page, '#icon', /^sans-serif, MysteryIcons, sans-serif$/);
  // The face count stays at one, so a size-based cache would keep ignoring MysteryIcons.
  await page.evaluate(() => {
    document.fonts.delete(window.__placeholder!);
    document.fonts.add(window.__icon!);
    document.getElementById('icon')!.style.fontSize = '33px';
    document.getElementById('icon')!.setAttribute('data-touch', '1');
  });
  await expectFamily(page, '#icon', /^MysteryIcons, sans-serif$/);
});

test('replaces fonts before the first paint even with a delayed defer script', async ({ page }) => {
  const { errors } = await setup(page, `
    <p id="target" style="font-family: Georgia, serif">Text</p>
    <script>window.__parseTime = [performance.now(), getComputedStyle(document.getElementById('target')).fontFamily];</script>
    <script defer src="/slow.js"></script>`, {
    slowScript: true,
    head: `<script>
      window.__samples = [];
      window.__paints = [];
      function sample() {
        const element = document.getElementById('target');
        window.__samples.push([performance.now(), element ? getComputedStyle(element).fontFamily : null, window.__slowRan ?? null]);
        if (window.__samples.length < 120) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__paints.push([entry.name, entry.startTime]);
      }).observe({ type: 'paint', buffered: true });
    </script>`,
  });
  await page.waitForFunction(() => window.__slowRan !== undefined);
  const { samples, paints, parseTime } = await page.evaluate(() => ({
    samples: window.__samples!, paints: window.__paints!, parseTime: window.__parseTime!,
  }));
  expect(parseTime[1]).toBe('serif, Georgia, serif');
  expect(parseTime[0]).toBeLessThan(await page.evaluate(() => window.__slowRan!));
  expect(samples.every(sample => sample[1] === null || sample[1] === 'serif, Georgia, serif')).toBe(true);
  expect(paints.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('applies dynamic changes and stylesheet loads before the next frame', async ({ page }) => {
  await setup(page, `
    <style>body { font-family: Arial, sans-serif; } .book { font-family: Georgia, serif; }</style>
    <div id="container"><span id="target">Text</span></div>
  `);
  await expectFamily(page, '#target', /^sans-serif, Arial, sans-serif$/);

  const inserted = await page.evaluate(async () => {
    const span = document.createElement('span');
    span.id = 'added';
    span.textContent = 'More';
    document.getElementById('container')!.append(span);
    await new Promise(requestAnimationFrame);
    return getComputedStyle(span).fontFamily;
  });
  expect(inserted).toBe('sans-serif, Arial, sans-serif');

  await page.locator('#container').evaluate(element => element.classList.add('book'));
  expect(await nextFrameFamily(page, '#added')).toBe('serif, Georgia, serif');

  await page.locator('#added').evaluate(element => { element.style.fontFamily = 'Courier, monospace'; });
  expect(await nextFrameFamily(page, '#added')).toBe('monospace, Courier, monospace');

  const late = await page.evaluate(async () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/late-mono.css';
    const loaded = new Promise(resolve => link.addEventListener('load', resolve, { once: true }));
    document.head.append(link);
    await loaded;
    await new Promise(requestAnimationFrame);
    return getComputedStyle(document.getElementById('target')!).fontFamily;
  });
  expect(late).toBe('monospace');
});

test('prunes whole protected subtrees without reading or writing inside them', async ({ page }) => {
  await setup(page, `
    <style>.katex { font-family: 'Latin Modern Math', serif; }</style>
    <div id="outside" style="font-family: Arial, sans-serif">Text</div>
    <div class="katex" id="formula"><span id="inner">x²</span><span id="inner-own" style="font-family: Georgia, serif">y</span></div>
  `);
  await expectFamily(page, '#outside', /^sans-serif, Arial, sans-serif$/);
  expect(await page.evaluate(() => window.__metrics.boundaryMeasurements)).toBe(0);
  expect(await page.evaluate(() => window.__metrics.boundaryWrites)).toBe(0);
  expect(await family(page, '#inner-own')).toBe('Georgia, serif');
});

test('reads pseudo styles only for elements a pseudo rule can target', async ({ page }) => {
  const items = Array.from({ length: 200 }, (_, index) => `<span class="item">Text ${index}</span>`).join('');
  await setup(page, `
    <style>
      #parent { font-family: Arial, sans-serif; }
      .item { font-family: Georgia, serif; }
      #icon::before { content: '\\e001'; font-family: 'Material Icons'; }
      #decorated::after { content: '→'; }
    </style>
    <div id="parent">${items}<span id="icon"></span><span id="decorated">next</span></div>
  `, { inject: false });
  await page.evaluate(() => document.fonts.ready);
  await start(page);
  await expectFamily(page, '#parent', /^sans-serif, Arial, sans-serif$/);
  await expectFamily(page, '.item:first-child', /^serif, Georgia, serif$/);
  // The inheriting icon host keeps its own family so the pseudo font stays untouched.
  expect(await family(page, '#icon')).toBe('Arial, sans-serif');
  expect(await page.locator('#icon').evaluate(element => getComputedStyle(element, '::before').fontFamily))
    .toBe('"Material Icons"');
  const pseudoReads = await page.evaluate(() => window.__metrics.pseudoReads);
  // Two candidate elements over a few passes, not 200 elements times three pseudos.
  expect(pseudoReads).toBeGreaterThan(0);
  expect(pseudoReads).toBeLessThan(30);
});

test('skips pseudo style reads when the page has no pseudo rules', async ({ page }) => {
  const items = Array.from({ length: 200 }, (_, index) => `<span class="item">Text ${index}</span>`).join('');
  await setup(page, `
    <style>
      #parent { font-family: Arial, sans-serif; }
      .item { font-family: Georgia, serif; }
    </style>
    <div id="parent">${items}</div>
  `);
  await expectFamily(page, '#parent', /^sans-serif, Arial, sans-serif$/);
  await expectFamily(page, '.item:first-child', /^serif, Georgia, serif$/);
  expect(await page.evaluate(() => window.__metrics.pseudoReads)).toBe(0);
});

test('falls back to per-element pseudo checks when a stylesheet is unreadable', async ({ page }) => {
  await page.route('http://cross-origin.test/icon.css', route => route.fulfill({
    contentType: 'text/css',
    body: `#icon::before { content: '\\e001'; font-family: 'Material Icons'; }`,
  }));
  await setup(page, `
    <link rel="stylesheet" href="http://cross-origin.test/icon.css">
    <div id="parent" style="font-family: Arial, sans-serif"><span id="icon"></span></div>
  `, { inject: false });
  await start(page);
  await expectFamily(page, '#parent', /^sans-serif, Arial, sans-serif$/);
  // The opaque sheet hides its pseudo rule, so candidate matching cannot be used.
  expect(await page.evaluate(() => window.__metrics.pseudoReads)).toBeGreaterThan(0);
  expect(await family(page, '#icon')).toBe('Arial, sans-serif');
  expect(await page.locator('#icon').evaluate(element => getComputedStyle(element, '::before').fontFamily))
    .toBe('"Material Icons"');
});

test('scans before paint while an external stylesheet is still loading', async ({ page }) => {
  await setup(page, `
    <style>#target { font-family: sans-serif; }</style>
    <p id="target">Text</p>
    <script>
      setTimeout(() => {
        const sheet = document.querySelector('style').sheet;
        sheet.insertRule('#target { font-family: Georgia, serif }', sheet.cssRules.length);
        window.__ruleAppliedAt = performance.now();
      }, 20);
    </script>
  `, {
    head: '<link rel="stylesheet" href="/slow-print.css" media="print">',
    afterInject: installFrameSamples,
  });
  const { appliedAt, samples, paints } = await page.evaluate(() => ({
    appliedAt: window.__ruleAppliedAt ?? 0,
    samples: window.__frameSamples ?? [],
    paints: window.__frameSamplesPaints ?? [],
  }));
  const afterRule = samples.filter(([time, family]) => time > appliedAt + 20 && family !== null);
  expect(paints.length).toBeGreaterThan(0);
  expect(appliedAt).toBeGreaterThan(0);
  expect(afterRule.length).toBeGreaterThan(0);
  expect(afterRule.every(([, family]) => family === 'serif, Georgia, serif')).toBe(true);
});

function installFrameSamples() {
  window.__frameSamples = [];
  window.__frameSamplesPaints = [];
  let frames = 0;
  function tick() {
    const target = document.getElementById('target');
    window.__frameSamples!.push([performance.now(), target ? getComputedStyle(target).fontFamily : null]);
    if (++frames < 60) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) window.__frameSamplesPaints!.push([entry.name, entry.startTime]);
  }).observe({ type: 'paint', buffered: true });
}
