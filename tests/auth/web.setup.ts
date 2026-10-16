/**
 * tests/auth/web.setup.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Playwright project "web:auth-setup" runs this file.
 * It performs web portal login and saves storageState to .auth/web-user.json.
 * Subsequent test projects load this file via `storageState` to bypass login.
 */

import { test as setup, expect } from '@playwright/test';
import * as path from 'path';
import { WEB_USER_EMAIL, WEB_USER_PASSWORD, WEB_BASE_URL } from '../../config/env';

const AUTH_FILE = path.resolve(__dirname, '../../.auth/web-user.json');

setup('web portal authentication', async ({ page }) => {
  console.log(`[web.setup] Logging in as ${WEB_USER_EMAIL}`);

  await page.goto(`${WEB_BASE_URL}/login`, { waitUntil: 'domcontentloaded' });

  // Fill email — self-healing selectors
  await page.locator([
    'input[type="email"]',
    'input[name="email"]',
    '[data-testid="email-input"]',
  ].join(', ')).fill(WEB_USER_EMAIL);

  // Fill password
  await page.locator([
    'input[type="password"]',
    'input[name="password"]',
    '[data-testid="password-input"]',
  ].join(', ')).fill(WEB_USER_PASSWORD);

  // Submit
  await page.locator([
    'button[type="submit"]',
    '[data-testid="login-button"]',
    'button:has-text("Sign in")',
    'button:has-text("Login")',
  ].join(', ')).click();

  // Wait for post-login redirect
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
  await page.waitForLoadState('networkidle');

  // Verify authentication succeeded — adjust selector to match your app's dashboard
  await expect(
    page.locator('[data-testid="user-menu"], [data-testid="dashboard"], nav').first()
  ).toBeVisible({ timeout: 10_000 });

  // Persist session for all subsequent tests
  await page.context().storageState({ path: AUTH_FILE });
  console.log(`[web.setup] Auth state saved → ${AUTH_FILE}`);
});
