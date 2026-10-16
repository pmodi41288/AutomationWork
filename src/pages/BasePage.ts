import { Page, Locator, expect, BrowserContext } from '@playwright/test';
import * as allure from 'allure-js-commons';
import { LocatorCandidate, LocatorStrategy, HealedLocatorResult } from '../types/index';

// ─── Self-Healing Config ──────────────────────────────────────────────────────

const DEFAULT_TIMEOUT      = 15_000;
const HEALING_TIMEOUT      = 3_000;  // Per-candidate probe timeout
const MAX_HEALING_ATTEMPTS = 5;

// ─── Locator Builder ──────────────────────────────────────────────────────────

/**
 * Builds a Playwright Locator from a LocatorCandidate using the appropriate
 * strategy. All strategies are native Playwright — no external deps.
 */
function buildLocator(page: Page, candidate: LocatorCandidate): Locator {
  const { strategy, value } = candidate;

  switch (strategy) {
    case 'css':
      return page.locator(value);

    case 'xpath':
      return page.locator(`xpath=${value}`);

    case 'data-testid':
      return page.getByTestId(value);

    case 'role': {
      // value format: "role:name" e.g. "button:Submit" or just "button"
      const [role, name] = value.split(':') as [string, string | undefined];
      return name
        ? page.getByRole(role as Parameters<Page['getByRole']>[0], { name })
        : page.getByRole(role as Parameters<Page['getByRole']>[0]);
    }

    case 'text':
      return page.getByText(value, { exact: false });

    case 'label':
      return page.getByLabel(value, { exact: false });

    case 'placeholder':
      return page.getByPlaceholder(value, { exact: false });

    default:
      return page.locator(value);
  }
}

/**
 * Probes whether a locator resolves to a visible element within the given timeout.
 */
async function probeLocator(locator: Locator, timeout: number): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

// ─── BasePage ─────────────────────────────────────────────────────────────────

/**
 * BasePage
 *
 * All page objects extend this class. It provides:
 *  - Self-healing locator resolution with cascade fallback strategies
 *  - Allure step wrapping for every interaction
 *  - Consistent navigation, wait, and assertion helpers
 *  - Full-page screenshot capture with automatic path management
 */
export abstract class BasePage {
  readonly page:    Page;
  readonly context: BrowserContext;

  /** Override in subclasses to define the page's relative path */
  protected readonly path: string = '/';

  /** Override in subclasses to define a reliable "page loaded" indicator */
  protected readonly pageLoadedSelector?: string;

  constructor(page: Page) {
    this.page    = page;
    this.context = page.context();
  }

  // ─── Navigation ────────────────────────────────────────────────────────────

  async navigate(url?: string): Promise<void> {
    const target = url ?? this.path;
    await allure.step(`Navigate to: ${target}`, async () => {
      await this.page.goto(target, { waitUntil: 'domcontentloaded' });
      await this.waitForPageLoad();
    });
  }

  async waitForPageLoad(timeout = DEFAULT_TIMEOUT): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded', { timeout });
    if (this.pageLoadedSelector) {
      await this.page.waitFor({ selector: this.pageLoadedSelector, timeout });
    }
  }

  async waitForNetworkIdle(timeout = DEFAULT_TIMEOUT): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout });
  }

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }

  async getTitle(): Promise<string> {
    return this.page.title();
  }

  // ─── Self-Healing Locator Resolution ───────────────────────────────────────

  /**
   * Resolves a locator using a cascade of fallback strategies.
   *
   * Priority order (most specific → most semantic):
   *   1. data-testid      — most stable, preferred
   *   2. CSS selector     — direct if unambiguous
   *   3. ARIA role+name   — semantic, accessible
   *   4. Label text       — form-field association
   *   5. Placeholder      — input hint
   *   6. Visible text     — last resort text match
   *   7. XPath            — fallback for complex DOM
   *
   * @param primary         Primary locator candidate (preferred strategy)
   * @param fallbacks       Ordered list of fallback candidates
   * @param options.timeout Per-candidate probe timeout in ms
   * @returns               The first Locator that resolves to a visible element
   */
  async resolveLocator(
    primary: LocatorCandidate,
    fallbacks: LocatorCandidate[] = [],
    options: { timeout?: number; label?: string } = {}
  ): Promise<Locator> {
    const { timeout = HEALING_TIMEOUT, label = primary.value } = options;
    const candidates = [primary, ...fallbacks];

    let lastLocator: Locator = buildLocator(this.page, primary);
    const healResult: HealedLocatorResult = {
      strategy: primary.strategy,
      value:    primary.value,
      attempts: 0,
      healed:   false,
    };

    for (let i = 0; i < Math.min(candidates.length, MAX_HEALING_ATTEMPTS); i++) {
      const candidate = candidates[i];
      const locator   = buildLocator(this.page, candidate);
      healResult.attempts++;

      const found = await probeLocator(locator, timeout);
      if (found) {
        if (i > 0) {
          healResult.healed   = true;
          healResult.strategy = candidate.strategy;
          healResult.value    = candidate.value;
          console.warn(
            `[Self-Heal] "${label}" healed after ${i} attempt(s). ` +
            `Using strategy "${candidate.strategy}": "${candidate.value}"`
          );
        }
        return locator;
      }

      lastLocator = locator;
    }

    // All candidates failed — log and return primary for Playwright to handle
    console.error(
      `[Self-Heal] All ${healResult.attempts} locator candidates failed for "${label}". ` +
      `Falling back to primary; Playwright will surface the error.`
    );
    return buildLocator(this.page, primary);
  }

  /**
   * Convenience: resolves a locator from a plain CSS/XPath selector
   * with optional data-testid and role fallbacks.
   *
   * Usage:
   *   const btn = await this.find('#submit-btn', {
   *     testId: 'submit-button',
   *     role:   'button:Submit',
   *     text:   'Submit',
   *   });
   */
  async find(
    selector: string,
    fallbacks: Partial<Record<'testId' | 'role' | 'text' | 'label' | 'placeholder', string>> = {},
    timeout?: number
  ): Promise<Locator> {
    const primary: LocatorCandidate = selector.startsWith('//')
      ? { strategy: 'xpath', value: selector }
      : { strategy: 'css',   value: selector };

    const candidates: LocatorCandidate[] = [];

    if (fallbacks.testId)
      candidates.push({ strategy: 'data-testid',  value: fallbacks.testId });
    if (fallbacks.role)
      candidates.push({ strategy: 'role',         value: fallbacks.role });
    if (fallbacks.label)
      candidates.push({ strategy: 'label',        value: fallbacks.label });
    if (fallbacks.placeholder)
      candidates.push({ strategy: 'placeholder',  value: fallbacks.placeholder });
    if (fallbacks.text)
      candidates.push({ strategy: 'text',         value: fallbacks.text });

    return this.resolveLocator(primary, candidates, { timeout, label: selector });
  }

  // ─── Wrapped Interactions ──────────────────────────────────────────────────

  /**
   * Click with Allure step annotation and healing fallback.
   */
  async click(
    primary: LocatorCandidate | string,
    fallbacks: LocatorCandidate[] = [],
    options: { timeout?: number; force?: boolean; label?: string } = {}
  ): Promise<void> {
    const candidate = typeof primary === 'string'
      ? { strategy: 'css' as LocatorStrategy, value: primary }
      : primary;

    const label = options.label ?? candidate.value;

    await allure.step(`Click: ${label}`, async () => {
      const locator = await this.resolveLocator(candidate, fallbacks, { label });
      await locator.click({
        timeout: options.timeout ?? DEFAULT_TIMEOUT,
        force:   options.force,
      });
    });
  }

  /**
   * Fill (clear + type) with Allure step annotation.
   * Masks the value in Allure output if `secret: true`.
   */
  async fill(
    primary: LocatorCandidate | string,
    value: string,
    fallbacks: LocatorCandidate[] = [],
    options: { timeout?: number; secret?: boolean; label?: string } = {}
  ): Promise<void> {
    const candidate = typeof primary === 'string'
      ? { strategy: 'css' as LocatorStrategy, value: primary }
      : primary;

    const label       = options.label ?? candidate.value;
    const displayValue = options.secret ? '••••••••' : value;

    await allure.step(`Fill "${label}" with "${displayValue}"`, async () => {
      const locator = await this.resolveLocator(candidate, fallbacks, { label });
      await locator.fill(value, { timeout: options.timeout ?? DEFAULT_TIMEOUT });
    });
  }

  /**
   * Select an option from a <select> element.
   */
  async selectOption(
    primary: LocatorCandidate | string,
    value: string | { label?: string; value?: string; index?: number },
    fallbacks: LocatorCandidate[] = []
  ): Promise<void> {
    const candidate = typeof primary === 'string'
      ? { strategy: 'css' as LocatorStrategy, value: primary }
      : primary;

    await allure.step(`Select option "${JSON.stringify(value)}" in ${candidate.value}`, async () => {
      const locator = await this.resolveLocator(candidate, fallbacks);
      await locator.selectOption(value as string, { timeout: DEFAULT_TIMEOUT });
    });
  }

  /**
   * Check or uncheck a checkbox.
   */
  async setChecked(
    primary: LocatorCandidate | string,
    checked: boolean,
    fallbacks: LocatorCandidate[] = []
  ): Promise<void> {
    const candidate = typeof primary === 'string'
      ? { strategy: 'css' as LocatorStrategy, value: primary }
      : primary;

    await allure.step(`Set checkbox "${candidate.value}" to ${checked}`, async () => {
      const locator = await this.resolveLocator(candidate, fallbacks);
      await locator.setChecked(checked, { timeout: DEFAULT_TIMEOUT });
    });
  }

  /**
   * Hover over an element.
   */
  async hover(
    primary: LocatorCandidate | string,
    fallbacks: LocatorCandidate[] = []
  ): Promise<void> {
    const candidate = typeof primary === 'string'
      ? { strategy: 'css' as LocatorStrategy, value: primary }
      : primary;

    await allure.step(`Hover: ${candidate.value}`, async () => {
      const locator = await this.resolveLocator(candidate, fallbacks);
      await locator.hover({ timeout: DEFAULT_TIMEOUT });
    });
  }

  /**
   * Get inner text of an element.
   */
  async getText(
    primary: LocatorCandidate | string,
    fallbacks: LocatorCandidate[] = []
  ): Promise<string> {
    const candidate = typeof primary === 'string'
      ? { strategy: 'css' as LocatorStrategy, value: primary }
      : primary;

    const locator = await this.resolveLocator(candidate, fallbacks);
    return locator.innerText({ timeout: DEFAULT_TIMEOUT });
  }

  /**
   * Get the value of an attribute.
   */
  async getAttribute(
    primary: LocatorCandidate | string,
    attribute: string,
    fallbacks: LocatorCandidate[] = []
  ): Promise<string | null> {
    const candidate = typeof primary === 'string'
      ? { strategy: 'css' as LocatorStrategy, value: primary }
      : primary;

    const locator = await this.resolveLocator(candidate, fallbacks);
    return locator.getAttribute(attribute, { timeout: DEFAULT_TIMEOUT });
  }

  /**
   * Check whether an element is visible.
   */
  async isVisible(
    primary: LocatorCandidate | string,
    fallbacks: LocatorCandidate[] = [],
    timeout = HEALING_TIMEOUT
  ): Promise<boolean> {
    const candidate = typeof primary === 'string'
      ? { strategy: 'css' as LocatorStrategy, value: primary }
      : primary;

    try {
      const locator = await this.resolveLocator(candidate, fallbacks, { timeout });
      return locator.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Wait for an element to be visible.
   */
  async waitForVisible(
    primary: LocatorCandidate | string,
    fallbacks: LocatorCandidate[] = [],
    timeout = DEFAULT_TIMEOUT
  ): Promise<Locator> {
    const candidate = typeof primary === 'string'
      ? { strategy: 'css' as LocatorStrategy, value: primary }
      : primary;

    const locator = await this.resolveLocator(candidate, fallbacks, { timeout });
    await locator.waitFor({ state: 'visible', timeout });
    return locator;
  }

  /**
   * Wait for an element to be hidden/detached.
   */
  async waitForHidden(
    primary: LocatorCandidate | string,
    timeout = DEFAULT_TIMEOUT
  ): Promise<void> {
    const candidate = typeof primary === 'string'
      ? { strategy: 'css' as LocatorStrategy, value: primary }
      : primary;

    const locator = buildLocator(this.page, candidate);
    await locator.waitFor({ state: 'hidden', timeout });
  }

  // ─── Assertions ────────────────────────────────────────────────────────────

  async assertVisible(locator: Locator, message?: string): Promise<void> {
    await allure.step(`Assert visible: ${message ?? 'element'}`, async () => {
      await expect(locator, message).toBeVisible({ timeout: DEFAULT_TIMEOUT });
    });
  }

  async assertText(locator: Locator, expected: string, message?: string): Promise<void> {
    await allure.step(`Assert text: "${expected}"`, async () => {
      await expect(locator, message).toHaveText(expected, { timeout: DEFAULT_TIMEOUT });
    });
  }

  async assertContainsText(locator: Locator, expected: string, message?: string): Promise<void> {
    await allure.step(`Assert contains text: "${expected}"`, async () => {
      await expect(locator, message).toContainText(expected, { timeout: DEFAULT_TIMEOUT });
    });
  }

  async assertUrl(pattern: string | RegExp, message?: string): Promise<void> {
    await allure.step(`Assert URL matches: ${pattern}`, async () => {
      await expect(this.page, message).toHaveURL(pattern, { timeout: DEFAULT_TIMEOUT });
    });
  }

  async assertTitle(pattern: string | RegExp, message?: string): Promise<void> {
    await allure.step(`Assert title matches: ${pattern}`, async () => {
      await expect(this.page, message).toHaveTitle(pattern, { timeout: DEFAULT_TIMEOUT });
    });
  }

  async assertNotVisible(locator: Locator, message?: string): Promise<void> {
    await allure.step(`Assert not visible: ${message ?? 'element'}`, async () => {
      await expect(locator, message).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
    });
  }

  async assertEnabled(locator: Locator, message?: string): Promise<void> {
    await allure.step(`Assert enabled: ${message ?? 'element'}`, async () => {
      await expect(locator, message).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
    });
  }

  async assertDisabled(locator: Locator, message?: string): Promise<void> {
    await allure.step(`Assert disabled: ${message ?? 'element'}`, async () => {
      await expect(locator, message).toBeDisabled({ timeout: DEFAULT_TIMEOUT });
    });
  }

  async assertCount(locator: Locator, count: number, message?: string): Promise<void> {
    await allure.step(`Assert count = ${count}: ${message ?? 'elements'}`, async () => {
      await expect(locator, message).toHaveCount(count, { timeout: DEFAULT_TIMEOUT });
    });
  }

  // ─── Screenshot ────────────────────────────────────────────────────────────

  /**
   * Takes a full-page screenshot and returns the PNG buffer.
   * Automatically attaches it to the current Allure step.
   */
  async takeScreenshot(name?: string): Promise<Buffer> {
    const screenshot = await this.page.screenshot({ fullPage: true });
    await allure.attachment(name ?? 'screenshot', screenshot, 'image/png');
    return screenshot;
  }

  // ─── Keyboard / Mouse ──────────────────────────────────────────────────────

  async pressKey(key: string): Promise<void> {
    await allure.step(`Press key: ${key}`, async () => {
      await this.page.keyboard.press(key);
    });
  }

  async scrollToBottom(): Promise<void> {
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  }

  async scrollToTop(): Promise<void> {
    await this.page.evaluate(() => window.scrollTo(0, 0));
  }

  // ─── Dialogs ───────────────────────────────────────────────────────────────

  async acceptDialog(): Promise<void> {
    this.page.once('dialog', (dialog) => dialog.accept());
  }

  async dismissDialog(): Promise<void> {
    this.page.once('dialog', (dialog) => dialog.dismiss());
  }

  // ─── Utility ───────────────────────────────────────────────────────────────

  /**
   * Executes JavaScript in the browser context.
   */
  async evaluate<T>(fn: () => T): Promise<T> {
    return this.page.evaluate(fn);
  }

  /**
   * Waits for a fixed amount of milliseconds.
   * Use sparingly — prefer waitForVisible / waitForNetworkIdle.
   */
  async wait(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /**
   * Clears browser local storage and session storage.
   */
  async clearStorage(): Promise<void> {
    await this.page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
  }

  /**
   * Returns all console messages captured during the session.
   */
  listenForConsoleErrors(): string[] {
    const errors: string[] = [];
    this.page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    return errors;
  }
}
