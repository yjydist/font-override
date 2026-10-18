import { createClassifier } from './classifier';
import { prepend } from './font-families';
import { isProtected, SPECIAL_SUBTREE } from './protection';
import { FONT_PROPERTIES, type ElementRecord, type FontSettings, type FontSnapshot, type InlineDeclaration, type StyledElement } from './types';

const SKIP_TAGS = new Set(['HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'TEMPLATE', 'NOSCRIPT']);

function hasInlineStyle(element: Element): element is StyledElement {
  return 'style' in element && element.style instanceof CSSStyleDeclaration;
}

function readInline(element: StyledElement): InlineDeclaration {
  return {
    value: element.style.getPropertyValue('font-family'),
    priority: element.style.getPropertyPriority('font-family'),
  };
}

function sameDeclaration(a: InlineDeclaration, b: InlineDeclaration): boolean {
  return a.value === b.value && a.priority === b.priority;
}

function writeInline(element: StyledElement, declaration: InlineDeclaration): void {
  if (sameDeclaration(readInline(element), declaration)) return;
  if (declaration.value) {
    element.style.setProperty('font-family', declaration.value, declaration.priority);
  } else {
    element.style.removeProperty('font-family');
  }
}

export function createScanner(settings: Readonly<FontSettings>) {
  const classifier = createClassifier();
  const records = new WeakMap<StyledElement, ElementRecord>();
  const dirtyRoots = new Set<Element>();
  let walker: ReturnType<typeof makeWalker> | null = null;
  let scheduled = false;
  let batchLimit = 64;
  let fullScanTimer: number | null = null;

  function processBatch(elements: Element[]): void {
    // Drain external mutations before silencing only our synchronous read/write transaction.
    handleMutations(observer.takeRecords());
    observer.disconnect();
    const restored = new Map<StyledElement, ElementRecord>();
    const plans = new Map<StyledElement, ElementRecord | null>();
    try {
      classifier.ensureConnected();
      for (const element of elements) {
        for (let current: Element | null = element; current; current = current.parentElement) {
          if (!hasInlineStyle(current)) continue;
          if (restored.has(current)) break;
          const record = records.get(current);
          if (!record) continue;
          const inline = readInline(current);
          if (!sameDeclaration(inline, record.applied)) record.original = inline;
          restored.set(current, record);
          writeInline(current, record.original);
        }
      }

      // Take ALL snapshots before writing any replacement, including protected boundaries.
      for (const element of elements) {
        if (!element.isConnected || !hasInlineStyle(element)) continue;
        const special = element.closest(SPECIAL_SUBTREE);
        if (special && special !== element) {
          plans.set(element, null);
          continue;
        }
        const computed = getComputedStyle(element);
        const font = Object.fromEntries(FONT_PROPERTIES.map(property => [property, computed[property]])) as FontSnapshot;
        if (!font.fontFamily) continue;
        const language = element.closest('[lang]')?.getAttribute('lang') || '';
        const family = isProtected(element, font) ? font.fontFamily
          : prepend(settings[classifier.classify(font, language)], font.fontFamily);
        plans.set(element, {
          original: readInline(element),
          applied: { value: family, priority: 'important' },
        });
      }
    } finally {
      // Restore ancestors not included in this batch, even if measuring failed.
      for (const [element, record] of restored) {
        if (plans.has(element)) continue;
        if (sameDeclaration(readInline(element), record.original)) writeInline(element, record.applied);
      }
      for (const [element, plan] of plans) {
        if (plan && element.isConnected) {
          writeInline(element, plan.applied);
          // CSSOM serialization can differ from our generated font list.
          plan.applied = readInline(element);
          records.set(element, plan);
        } else {
          records.delete(element);
        }
      }
      observe();
    }
  }

  function makeWalker(root: Element) {
    let first = true;
    const tree = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(element) {
        return element === classifier.host || (element instanceof Element && SKIP_TAGS.has(element.tagName))
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    return {
      next() {
        if (first) { first = false; return root; }
        const next = tree.nextNode();
        return next instanceof Element ? next : null;
      },
    };
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 150 });
    else window.setTimeout(run, 16);
  }

  function queueRoot(root: Node | null | undefined): void {
    if (root?.nodeType === Node.DOCUMENT_NODE) root = document.documentElement;
    if (root?.nodeType !== Node.ELEMENT_NODE) root = root?.parentElement;
    if (!(root instanceof Element) || !root.isConnected
      || root === classifier.host || SKIP_TAGS.has(root.tagName)) return;
    for (const pending of dirtyRoots) {
      if (pending.contains(root)) return;
      if (root.contains(pending)) dirtyRoots.delete(pending);
    }
    dirtyRoots.add(root);
    schedule();
  }

  function requestFullScan(): void {
    // One timer per burst (rather than resetting it) also prevents starvation on busy pages.
    if (fullScanTimer !== null) return;
    fullScanTimer = window.setTimeout(() => {
      fullScanTimer = null;
      dirtyRoots.clear();
      walker = null;
      queueRoot(document.documentElement);
    }, 75);
  }

  function run(): void {
    scheduled = false;
    const elements: Element[] = [];
    const start = performance.now();
    while (elements.length < batchLimit && performance.now() - start < 6) {
      if (!walker) {
        const root = dirtyRoots.values().next().value;
        if (!root) break;
        dirtyRoots.delete(root);
        if (!root.isConnected) continue;
        walker = makeWalker(root);
      }
      const element = walker.next();
      if (!element) { walker = null; continue; }
      if (element.isConnected) elements.push(element);
    }
    if (elements.length) processBatch(elements);
    const elapsed = performance.now() - start;
    if (elapsed > 12) batchLimit = Math.max(8, Math.floor(batchLimit / 2));
    else if (elapsed < 4) batchLimit = Math.min(128, batchLimit + 8);
    if (walker || dirtyRoots.size) schedule();
  }

  function handleMutations(mutations: MutationRecord[]): void {
    for (const mutation of mutations) {
      const target = mutation.target;
      if (target === classifier.host) continue;
      if (mutation.type === 'attributes') {
        if (target instanceof Element && mutation.attributeName
          && target.getAttribute(mutation.attributeName) !== mutation.oldValue) requestFullScan();
      } else if ((target instanceof Element && target.closest('head, style'))
        || target.parentElement?.closest('style')) {
        requestFullScan();
      } else {
        // Include siblings for :empty / :nth-child and inherited font changes.
        queueRoot(target);
      }
    }
  }

  const observer = new MutationObserver(handleMutations);
  function observe(): void {
    observer.observe(document, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeOldValue: true,
    });
  }

  function fontsChanged(): void {
    classifier.clearCache();
    requestFullScan();
  }

  return {
    requestFullScan,
    start(): void {
      observe();
      queueRoot(document.documentElement);
      document.fonts?.ready.then(fontsChanged);
      document.fonts?.addEventListener('loadingdone', fontsChanged);
      document.fonts?.addEventListener('loadingerror', fontsChanged);
      document.addEventListener('load', event => {
        if (event.target instanceof HTMLLinkElement && event.target.relList.contains('stylesheet')) requestFullScan();
      }, true);
      window.addEventListener('resize', requestFullScan, { passive: true });
      window.addEventListener('pageshow', requestFullScan);
    },
  };
}
