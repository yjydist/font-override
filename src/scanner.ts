import { createClassifier } from './classifier';
import { prepend } from './font-families';
import { createProtector, SPECIAL_SUBTREE } from './protection';
import {
  GENERIC_FAMILIES, fontCacheKey, readFont,
  type ElementRecord, type FontSnapshot, type InlineDeclaration, type StyledElement,
} from './types';

const SKIP_TAGS = new Set(['HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'TEMPLATE', 'NOSCRIPT']);

interface Plan {
  original: InlineDeclaration;
  applied: InlineDeclaration;
  font: FontSnapshot;
  language: string;
}

interface Deferred {
  element: StyledElement;
  parent: Element | null;
}

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

function isStylesheetLink(node: Node): node is HTMLLinkElement {
  return node instanceof HTMLLinkElement && node.relList.contains('stylesheet');
}

export function createScanner() {
  const classifier = createClassifier();
  const protector = createProtector(classifier);
  const records = new WeakMap<StyledElement, ElementRecord>();
  // Expected computed family after the last pass; only used to skip no-op style edits.
  const lastComputed = new WeakMap<Element, string>();
  const dirtyRoots = new Set<Element>();
  // Styles across these sheets may be applied before their load event; keep a
  // pre-paint scan pending until every one has settled.
  const pendingSheets = new Set<HTMLLinkElement>();
  let prePaintFrame = 0;

  function queueRoot(root: Node | null | undefined): void {
    let element = root;
    if (element?.nodeType === Node.DOCUMENT_NODE) element = document.documentElement;
    if (element?.nodeType !== Node.ELEMENT_NODE) element = element?.parentElement;
    if (!(element instanceof Element) || !element.isConnected
      || element === classifier.host || SKIP_TAGS.has(element.tagName)) return;
    dirtyRoots.add(element);
  }

  function collect(root: Element, pruneBoundaries: boolean, boundaries: Element[]): Element[] {
    const elements: Element[] = [root];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (!(node instanceof Element) || node === classifier.host) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
        if (pruneBoundaries && node.matches(SPECIAL_SUBTREE)) {
          // Visit the boundary itself to keep its own font stable, never its descendants.
          boundaries.push(node);
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof Element) elements.push(node);
    }
    return elements;
  }

  function restoreChain(start: Element, restored: Map<StyledElement, ElementRecord>): void {
    for (let current: Element | null = start; current; current = current.parentElement) {
      if (!hasInlineStyle(current) || restored.has(current)) continue;
      const record = records.get(current);
      if (!record) continue;
      // A page write while the override was active becomes the new original.
      const inline = readInline(current);
      if (!sameDeclaration(inline, record.applied)) record.original = inline;
      writeInline(current, record.original);
      restored.set(current, record);
    }
  }

  /** Restore script-written declarations so readings reflect the page's own styles. */
  function releaseRecords(
    elements: Element[],
    restored: Map<StyledElement, ElementRecord>,
  ): void {
    for (const element of elements) {
      if (!hasInlineStyle(element)) continue;
      const record = records.get(element);
      if (!record) continue;
      try {
        const inline = readInline(element);
        if (!sameDeclaration(inline, record.applied)) record.original = inline;
        writeInline(element, record.original);
      } catch {
        // Keep processing the rest of the subtree.
      }
      records.delete(element);
      restored.delete(element);
    }
  }

  function readPlans(
    elements: Element[],
    rootElement: Element,
    plans: Map<StyledElement, Plan>,
    deferred: Deferred[],
    ancestorModified: boolean,
    pseudoScope: Set<Element> | null,
  ): void {
    const styles = new WeakMap<Element, CSSStyleDeclaration>();
    const modified = new WeakMap<Element, boolean>();
    const languages = new WeakMap<Element, string>();

    function computedOf(element: Element): CSSStyleDeclaration {
      let computed = styles.get(element);
      if (!computed) {
        computed = getComputedStyle(element);
        styles.set(element, computed);
      }
      return computed;
    }

    function languageOf(element: Element): string {
      const stored = languages.get(element);
      if (stored !== undefined) return stored;
      const parent = element.parentElement;
      const language = element.getAttribute('lang') ?? (parent ? languageOf(parent) : '');
      languages.set(element, language);
      return language;
    }

    for (const element of elements) {
      if (!element.isConnected || !hasInlineStyle(element)) continue;
      let computed: CSSStyleDeclaration;
      let family: string;
      let parentFamily = '';
      let parentPost: string | undefined;
      try {
        computed = computedOf(element);
        family = computed.fontFamily;
        if (!family) continue;
        const parent = element.parentElement;
        if (parent) {
          parentFamily = computedOf(parent).fontFamily;
          parentPost = lastComputed.get(parent);
        }
      } catch {
        continue;
      }

      const parent = element.parentElement;
      const parentModified = parent
        ? (element === rootElement ? ancestorModified : (modified.get(parent) ?? false))
        : false;
      const differs = parent ? family !== parentFamily : true;

      if (!differs && !parentModified) {
        modified.set(element, false);
        lastComputed.set(element, family);
        continue;
      }

      const inline = readInline(element);
      // Protection judges inheritance before restoration; a restored equality is ambiguous.
      const inheritsOnly = !differs && !inline.value;
      const independent = differs || inline.value !== '';

      let protectedContent = true;
      let applied = family;
      let font: FontSnapshot;
      let language: string;
      try {
        font = readFont(computed);
        language = languageOf(element);
        const cacheKey = fontCacheKey(font, language);
        protectedContent = protector.isProtected(
          element, font, language, cacheKey, pseudoScope === null || pseudoScope.has(element),
        );
        if (!protectedContent) {
          applied = prepend(GENERIC_FAMILIES[classifier.classify(font, language, cacheKey)], font.fontFamily);
        }
      } catch {
        // Treat unreadable elements as protected instead of guessing.
        modified.set(element, false);
        lastComputed.set(element, family);
        continue;
      }

      if (protectedContent) {
        if (inheritsOnly) {
          // Shield inherited PUA/icon content from an overridden ancestor.
          plans.set(element, { original: inline, applied: { value: family, priority: 'important' }, font, language });
        }
        modified.set(element, false);
        lastComputed.set(element, family);
        continue;
      }

      if (!independent) {
        // Equal after restoring ancestors: either it inherits, or it has its own rule
        // with the same family. Resolve against the applied state after writing.
        deferred.push({ element, parent });
        modified.set(element, true);
        lastComputed.set(element, parentPost ?? parentFamily);
        continue;
      }

      if (applied === family) {
        modified.set(element, false);
        lastComputed.set(element, family);
        continue;
      }

      plans.set(element, { original: inline, applied: { value: applied, priority: 'important' }, font, language });
      modified.set(element, true);
      lastComputed.set(element, applied);
    }
  }

  function writePlans(
    plans: Map<StyledElement, Plan>,
    restored: Map<StyledElement, ElementRecord>,
  ): void {
    for (const [element, plan] of plans) {
      if (!element.isConnected) continue;
      try {
        writeInline(element, plan.applied);
        // CSSOM serialization can differ from the generated list.
        plan.applied = readInline(element);
        records.set(element, plan);
        lastComputed.set(element, plan.applied.value);
      } catch {
        records.delete(element);
      }
    }
    // Restore ancestors that were temporarily released but are outside this pass.
    for (const [element, record] of restored) {
      if (plans.has(element) || !element.isConnected) continue;
      try {
        if (sameDeclaration(readInline(element), record.original)) writeInline(element, record.applied);
      } catch {
        // Ignore a single unreachable ancestor.
      }
    }
  }

  /**
   * After the applied state is in place, an element whose family now differs from its
   * parent keeps its own declaration: it must still be classified and replaced.
   */
  function resolveDeferred(deferred: Deferred[], pseudoScope: Set<Element> | null): void {
    for (const { element, parent } of deferred) {
      if (!element.isConnected) continue;
      try {
        const computed = getComputedStyle(element);
        const family = computed.fontFamily;
        const parentFamily = parent ? getComputedStyle(parent).fontFamily : '';
        if (family === parentFamily) {
          lastComputed.set(element, family);
          continue;
        }
        const font = readFont(computed);
        const language = element.closest('[lang]')?.getAttribute('lang') ?? '';
        const cacheKey = fontCacheKey(font, language);
        if (protector.isProtected(
          element, font, language, cacheKey, pseudoScope === null || pseudoScope.has(element),
        )) {
          lastComputed.set(element, family);
          continue;
        }
        const applied = prepend(GENERIC_FAMILIES[classifier.classify(font, language, cacheKey)], font.fontFamily);
        if (applied === font.fontFamily) {
          lastComputed.set(element, family);
          continue;
        }
        const plan: Plan = {
          original: readInline(element),
          applied: { value: applied, priority: 'important' },
          font,
          language,
        };
        writeInline(element, plan.applied);
        plan.applied = readInline(element);
        records.set(element, plan);
        lastComputed.set(element, plan.applied.value);
      } catch {
        // A single element must not abort the remaining deferred elements.
      }
    }
  }

  function shieldBoundary(root: Element): Plan | null {
    const parent = root.parentElement;
    if (!parent || !hasInlineStyle(root) || readInline(root).value) return null;
    const computed = getComputedStyle(root);
    if (computed.fontFamily !== getComputedStyle(parent).fontFamily) return null;
    const language = root.closest('[lang]')?.getAttribute('lang') ?? '';
    return {
      original: readInline(root),
      applied: { value: computed.fontFamily, priority: 'important' },
      font: readFont(computed),
      language,
    };
  }

  function processRoot(root: Element): void {
    if (!root.isConnected || root === classifier.host) return;
    const pending = observer.takeRecords();
    observer.disconnect();
    try {
      const restored = new Map<StyledElement, ElementRecord>();
      restoreChain(root, restored);
      const insideBoundary = root.closest(SPECIAL_SUBTREE) !== null;
      const boundaries: Element[] = [];
      const elements = collect(root, !insideBoundary, boundaries);
      releaseRecords(elements, restored);
      // A root that is itself a boundary is already in `elements`.
      const collected = new Set(elements);
      const nestedBoundaries = boundaries.filter(boundary => !collected.has(boundary));
      releaseRecords(nestedBoundaries, restored);
      elements.push(...nestedBoundaries);
      const plans = new Map<StyledElement, Plan>();
      const deferred: Deferred[] = [];
      let pseudoScope: Set<Element> | null = null;
      if (insideBoundary) {
        if (restored.size > 0) {
          const shield = shieldBoundary(root);
          if (shield) plans.set(root as StyledElement, shield);
        }
      } else {
        classifier.ensureConnected();
        pseudoScope = protector.pseudoCandidates(root);
        readPlans(elements, root, plans, deferred, restored.size > 0, pseudoScope);
      }
      writePlans(plans, restored);
      resolveDeferred(deferred, pseudoScope);
    } finally {
      observe();
    }
    if (pending.length) handleMutations(pending);
  }

  function flush(): void {
    if (!dirtyRoots.size) return;
    const candidates = [...dirtyRoots];
    dirtyRoots.clear();
    const roots = candidates.filter(root => root.isConnected
      && !candidates.some(other => other !== root && other.contains(root)));
    for (const root of roots) {
      try {
        processRoot(root);
      } catch {
        // A failed root must not block the remaining queue.
      }
    }
  }

  function handleMutations(mutations: MutationRecord[]): void {
    let full = false;
    for (const mutation of mutations) {
      const target = mutation.target;
      if (target === classifier.host) continue;
      if (mutation.type === 'attributes') {
        if (!(target instanceof Element) || target === classifier.host) continue;
        if (mutation.attributeName === 'style') {
          const previous = lastComputed.get(target);
          let current: string | undefined;
          try {
            current = getComputedStyle(target).fontFamily;
          } catch {
            current = undefined;
          }
          if (current !== undefined && previous !== undefined && current === previous) continue;
        }
        queueRoot(target);
      } else if (mutation.type === 'characterData') {
        const holder = target instanceof Element ? target : target.parentElement;
        if (holder?.closest('style, head')) full = true;
        else queueRoot(holder);
      } else {
        const headMutation = target instanceof Element && target.closest('style, head') !== null;
        for (const node of mutation.addedNodes) {
          if (node === classifier.host) continue;
          if (isStylesheetLink(node)) {
            pendingSheets.add(node);
            schedulePrePaintCheck();
          }
          if (headMutation) continue;
          if (node.nodeType === Node.ELEMENT_NODE) {
            if ((node as Element).tagName === 'STYLE' || isStylesheetLink(node)) full = true;
            queueRoot(node);
          } else if (node.nodeType === Node.TEXT_NODE) {
            queueRoot(node.parentElement);
          }
        }
        for (const node of mutation.removedNodes) {
          if (isStylesheetLink(node)) {
            pendingSheets.delete(node);
            full = true;
          }
          if (!headMutation && (node as Element).tagName === 'STYLE') full = true;
        }
        if (headMutation) {
          full = true;
        } else if (mutation.removedNodes.length) {
          queueRoot(target instanceof Element ? target : target.parentElement);
        }
      }
    }
    if (full) {
      // Style text and stylesheet links can add pseudo rules; rebuild their index.
      protector.clearCache();
      dirtyRoots.clear();
      queueRoot(document.documentElement);
    }
    flush();
  }

  const observer = new MutationObserver(handleMutations);

  function observe(): void {
    observer.observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
  }

  /** Font-face changes keep every applied declaration valid; only measurements need redoing. */
  function fontEnvironmentChanged(): void {
    classifier.clearCache();
    protector.clearCache();
    const root = document.documentElement;
    if (!root) return;
    try {
      processRoot(root);
    } catch {
      // Leave the page untouched on an unexpected failure.
    }
  }

  function fullScan(): void {
    const root = document.documentElement;
    if (!root) return;
    try {
      processRoot(root);
    } catch {
      // Leave the page untouched on an unexpected failure.
    }
  }

  /**
   * External stylesheets can apply before their load event fires, and that
   * application causes no mutation. While any such sheet is pending, keep one
   * scan in every rendering update so its fonts are replaced before the paint.
   * Load and error both settle a sheet, so the loop is bounded by the fetch.
   */
  function schedulePrePaintCheck(): void {
    for (const link of pendingSheets) {
      if (!link.isConnected) pendingSheets.delete(link);
    }
    if (prePaintFrame || !pendingSheets.size) return;
    prePaintFrame = requestAnimationFrame(() => {
      prePaintFrame = 0;
      fullScan();
      schedulePrePaintCheck();
    });
  }

  return {
    start(): void {
      observe();
      for (const link of document.querySelectorAll('link')) {
        if (isStylesheetLink(link) && !link.sheet) pendingSheets.add(link);
      }
      fullScan();
      schedulePrePaintCheck();
      const fonts = document.fonts;
      if (fonts) {
        fonts.ready.then(fontEnvironmentChanged, fontEnvironmentChanged);
        fonts.addEventListener('loadingdone', fontEnvironmentChanged);
        fonts.addEventListener('loadingerror', fontEnvironmentChanged);
      }
      document.addEventListener('load', event => {
        if (isStylesheetLink(event.target as Node)) {
          pendingSheets.delete(event.target as HTMLLinkElement);
          classifier.clearCache();
          protector.clearCache();
          fullScan();
          schedulePrePaintCheck();
        }
      }, true);
      document.addEventListener('error', event => {
        if (isStylesheetLink(event.target as Node)) {
          pendingSheets.delete(event.target as HTMLLinkElement);
          schedulePrePaintCheck();
        }
      }, true);
      window.addEventListener('resize', fullScan, { passive: true });
      window.addEventListener('pageshow', fullScan);
    },
  };
}
