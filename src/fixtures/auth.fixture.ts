/**
 * auth.fixture.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides `authenticatedPage` and `authenticatedContext` fixtures that
 * inject a pre-authenticated browser page, bypassing login for every test.
 *
 * Uses the storageState saved by global-setup / web.setup.ts.
 */

import { test as base, BrowserContext, Page } from '@playwright/test';
import * as path from 'path';

const WEB_AUTH_FILE        = path.resolve(process.cwd(), '.auth/web-user.json');
const MOTHERSHIP_AUTH_FILE = path.resolve(process.cwd(), '.auth/mothership-user.json');

// ─── Type Extension ───────────────────────────────────────────────────────────

type AuthFixtures = {
  /** Authenticated page for the web portal */
  authenticatedPage: Page;

  /** Authenticated browser context for the web portal */
  authenticatedContext: BrowserContext;

  /** Authenticated page for the mothership portal */
  mothershipPage: Page;

  /** Authenticated browser context for the mothership portal */
  mothershipContext: BrowserContext;
};

// ─── Auth Fixture ─────────────────────────────────────────────────────────────

export const authTest = base.extend<AuthFixtures>({

  // ── Web Portal ──────────────────────────────────────────────────────────────

  authenticatedContext: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: WEB_AUTH_FILE,
    });
    await use(context);
    await context.close();
  },

  authenticatedPage: async ({ authenticatedContext }, use) => {
    const page = await authenticatedContext.newPage();
    await use(page);
    await page.close();
  },

  // ── Mothership Portal ───────────────────────────────────────────────────────

  mothershipContext: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: MOTHERSHIP_AUTH_FILE,
      baseURL: process.env.MOTHERSHIP_BASE_URL,
    });
    await use(context);
    await context.close();
  },

  mothershipPage: async ({ mothershipContext }, use) => {
    const page = await mothershipContext.newPage();
    await use(page);
    await page.close();
  },
});

export { expect } from '@playwright/test';
