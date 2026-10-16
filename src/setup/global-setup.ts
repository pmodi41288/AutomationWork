/**
 * global-setup.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs once before the entire test suite.
 * Responsibilities:
 *   1. Validate required environment variables
 *   2. Ensure artifact directories exist
 *   3. Perform web portal authentication → save storageState to .auth/web-user.json
 *   4. Perform mothership portal authentication → save storageState to .auth/mothership-user.json
 *   5. Write allure environment.properties
 */

import { chromium, FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import {
  WEB_BASE_URL,
  MOTHERSHIP_BASE_URL,
  WEB_USER_EMAIL,
  WEB_USER_PASSWORD,
  MOTHERSHIP_USER_EMAIL,
  MOTHERSHIP_USER_PASSWORD,
  SCREENSHOTS_DIR,
  VIDEOS_DIR,
  EXCEL_DIR,
  ALLURE_RESULTS_DIR,
} from '../../config/env';

// ─── File Paths ───────────────────────────────────────────────────────────────

const ROOT         = path.resolve(__dirname, '../..');
const AUTH_DIR     = path.join(ROOT, '.auth');
export const WEB_AUTH_FILE         = path.join(AUTH_DIR, 'web-user.json');
export const MOTHERSHIP_AUTH_FILE  = path.join(AUTH_DIR, 'mothership-user.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[global-setup] Created directory: ${dir}`);
  }
}

function validateEnv(): void {
  const required: string[] = [];

  if (!WEB_BASE_URL)   required.push('WEB_BASE_URL');
  if (!WEB_USER_EMAIL) required.push('WEB_USER_EMAIL');
  if (!WEB_USER_PASSWORD) required.push('WEB_USER_PASSWORD');

  if (required.length > 0) {
    throw new Error(
      `[global-setup] Missing required environment variables: ${required.join(', ')}\n` +
      'Copy .env.example to .env and fill in your values.'
    );
  }
}

// ─── Allure Environment Properties ────────────────────────────────────────────

function writeAllureEnvironment(): void {
  const allureDir = path.resolve(ROOT, ALLURE_RESULTS_DIR);
  ensureDir(allureDir);

  const props = [
    `FRAMEWORK=Playwright`,
    `LANGUAGE=TypeScript`,
    `NODE_VERSION=${process.version}`,
    `ENVIRONMENT=${process.env.TEST_ENV ?? 'dev'}`,
    `BASE_URL=${WEB_BASE_URL}`,
    `MOTHERSHIP_URL=${MOTHERSHIP_BASE_URL}`,
    `CI=${process.env.CI ?? 'false'}`,
    `TIMESTAMP=${new Date().toISOString()}`,
  ].join('\n');

  fs.writeFileSync(path.join(allureDir, 'environment.properties'), props, 'utf-8');
  console.log('[global-setup] Allure environment.properties written.');
}

// ─── Web Portal Authentication ────────────────────────────────────────────────

async function authenticateWeb(): Promise<void> {
  console.log('[global-setup] Authenticating web portal…');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();

  try {
    await page.goto(`${WEB_BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // ── Email field ─────────────────────────────────────────────────────────
    // Self-healing: try multiple selectors
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[id="email"]',
      '[data-testid="email-input"]',
      '[placeholder*="email" i]',
    ];

    let emailFilled = false;
    for (const sel of emailSelectors) {
      try {
        await page.locator(sel).fill(WEB_USER_EMAIL, { timeout: 3_000 });
        emailFilled = true;
        break;
      } catch { /* try next */ }
    }
    if (!emailFilled) throw new Error('[global-setup] Could not find email input on web login page.');

    // ── Password field ──────────────────────────────────────────────────────
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      '[data-testid="password-input"]',
      '[placeholder*="password" i]',
    ];

    let passwordFilled = false;
    for (const sel of passwordSelectors) {
      try {
        await page.locator(sel).fill(WEB_USER_PASSWORD, { timeout: 3_000 });
        passwordFilled = true;
        break;
      } catch { /* try next */ }
    }
    if (!passwordFilled) throw new Error('[global-setup] Could not find password input on web login page.');

    // ── Submit ──────────────────────────────────────────────────────────────
    const submitSelectors = [
      'button[type="submit"]',
      '[data-testid="login-button"]',
      'button:has-text("Sign in")',
      'button:has-text("Log in")',
      'button:has-text("Login")',
      'input[type="submit"]',
    ];

    let submitted = false;
    for (const sel of submitSelectors) {
      try {
        await page.locator(sel).click({ timeout: 3_000 });
        submitted = true;
        break;
      } catch { /* try next */ }
    }
    if (!submitted) throw new Error('[global-setup] Could not find submit button on web login page.');

    // ── Wait for auth success ───────────────────────────────────────────────
    await page.waitForLoadState('networkidle', { timeout: 20_000 });

    // Verify we're no longer on the login page
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/auth')) {
      // Check for error messages
      const errorVisible = await page.locator(
        '[class*="error"], [role="alert"], [data-testid*="error"]'
      ).isVisible().catch(() => false);

      if (errorVisible) {
        const errorText = await page.locator('[class*="error"], [role="alert"]')
          .first()
          .textContent()
          .catch(() => 'Unknown error');
        throw new Error(`[global-setup] Web login failed: ${errorText}`);
      }
    }

    // Save session
    await context.storageState({ path: WEB_AUTH_FILE });
    console.log(`[global-setup] Web auth saved → ${WEB_AUTH_FILE}`);

  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}

// ─── Mothership Portal Authentication ────────────────────────────────────────

async function authenticateMothership(): Promise<void> {
  if (!MOTHERSHIP_USER_EMAIL || !MOTHERSHIP_USER_PASSWORD) {
    console.warn('[global-setup] Mothership credentials not set — skipping mothership auth.');
    // Write an empty storage state so the project doesn't error
    fs.writeFileSync(MOTHERSHIP_AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }), 'utf-8');
    return;
  }

  console.log('[global-setup] Authenticating mothership portal…');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page    = await context.newPage();

  try {
    await page.goto(`${MOTHERSHIP_BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      '[data-testid="email-input"]',
      '[placeholder*="email" i]',
    ];
    for (const sel of emailSelectors) {
      try { await page.locator(sel).fill(MOTHERSHIP_USER_EMAIL, { timeout: 3_000 }); break; }
      catch { /* try next */ }
    }

    const passwordSelectors = [
      'input[type="password"]',
      '[data-testid="password-input"]',
    ];
    for (const sel of passwordSelectors) {
      try { await page.locator(sel).fill(MOTHERSHIP_USER_PASSWORD, { timeout: 3_000 }); break; }
      catch { /* try next */ }
    }

    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Sign in")',
      'button:has-text("Login")',
      '[data-testid="login-button"]',
    ];
    for (const sel of submitSelectors) {
      try { await page.locator(sel).click({ timeout: 3_000 }); break; }
      catch { /* try next */ }
    }

    await page.waitForLoadState('networkidle', { timeout: 20_000 });
    await context.storageState({ path: MOTHERSHIP_AUTH_FILE });
    console.log(`[global-setup] Mothership auth saved → ${MOTHERSHIP_AUTH_FILE}`);

  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default async function globalSetup(_config: FullConfig): Promise<void> {
  console.log('\n[global-setup] ═══ Starting global setup ═══');

  // 1. Validate environment
  validateEnv();

  // 2. Ensure directories exist
  [AUTH_DIR, SCREENSHOTS_DIR, VIDEOS_DIR, EXCEL_DIR].forEach(ensureDir);

  // 3. Write Allure environment info
  writeAllureEnvironment();

  // 4. Authenticate portals
  await authenticateWeb();
  await authenticateMothership();

  console.log('[global-setup] ═══ Global setup complete ═══\n');
}
