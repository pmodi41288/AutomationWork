/**
 * tests/auth/mothership.setup.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Playwright project "mothership:auth-setup" runs this file.
 * Saves storageState to .auth/mothership-user.json.
 */

import { test as setup, expect } from '@playwright/test';
import * as path from 'path';
import {
  MOTHERSHIP_USER_EMAIL,
  MOTHERSHIP_USER_PASSWORD,
  MOTHERSHIP_BASE_URL,
} from '../../config/env';

const AUTH_FILE = path.resolve(__dirname, '../../.auth/mothership-user.json');

setup('mothership portal authentication', async ({ page }) => {
  if (!MOTHERSHIP_USER_EMAIL || !MOTHERSHIP_USER_PASSWORD) {
    console.warn('[mothership.setup] Credentials not set — writing empty auth state.');
    const fs = await import('fs');
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }), 'utf-8');
    return;
  }

  console.log(`[mothership.setup] Logging in as ${MOTHERSHIP_USER_EMAIL}`);

  await page.goto(`${MOTHERSHIP_BASE_URL}/login`, { waitUntil: 'domcontentloaded' });

  await page.locator([
    'input[type="email"]',
    'input[name="email"]',
    '[data-testid="email-input"]',
  ].join(', ')).fill(MOTHERSHIP_USER_EMAIL);

  await page.locator([
    'input[type="password"]',
    '[data-testid="password-input"]',
  ].join(', ')).fill(MOTHERSHIP_USER_PASSWORD);

  await page.locator([
    'button[type="submit"]',
    '[data-testid="login-button"]',
    'button:has-text("Sign in")',
  ].join(', ')).click();

  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });
  await page.waitForLoadState('networkidle');

  await expect(
    page.locator('[data-testid="user-menu"], [data-testid="dashboard"], nav').first()
  ).toBeVisible({ timeout: 10_000 });

  await page.context().storageState({ path: AUTH_FILE });
  console.log(`[mothership.setup] Auth state saved → ${AUTH_FILE}`);
});
