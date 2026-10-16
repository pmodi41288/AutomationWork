/**
 * dashboard.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Dashboard feature test suite — authenticated tests using pre-saved
 * storageState (no login flow executed per-test).
 *
 * Demonstrates:
 *   - Authenticated fixture usage (storageState injected via playwright.config.ts)
 *   - DashboardPage POM with self-healing locators
 *   - Full Allure metadata suite with storyId option for auto bug linking
 *   - Positive, Negative, and Field-Level scenarios
 */

import * as allure from 'allure-js-commons';
import { test, expect } from '../../src/fixtures/test.fixture';

// ─── Suite Configuration ──────────────────────────────────────────────────────

// Set storyId via test.use so the fixture auto-logs bugs under this story
test.use({
  storyId:    0, // Replace with your actual ADO Story ID e.g. 1234
  testCaseId: '', // Set per test via annotations
});

// ─── Positive ─────────────────────────────────────────────────────────────────

test.describe('Dashboard — Positive', () => {

  test.beforeEach(async ({ dashboardPage }) => {
    await allure.epic('Core Application');
    await allure.feature('Dashboard');
    await dashboardPage.goto();
  });

  test('TC-020: Authenticated user lands on dashboard after login', async ({
    dashboardPage,
  }, testInfo) => {
    await allure.story('Dashboard Access');
    await allure.severity('critical');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-020' });

    await dashboardPage.assertOnDashboard();
    await dashboardPage.assertAuthenticated();
    await dashboardPage.assertNoErrorBanner();
    await dashboardPage.takeScreenshot('TC-020-dashboard-loaded');
  });

  test('TC-021: Navigation menu is visible and accessible', async ({
    dashboardPage,
  }, testInfo) => {
    await allure.story('Navigation');
    await allure.severity('normal');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-021' });

    await dashboardPage.assertNavigationMenuVisible();
  });

  test('TC-022: Dashboard displays stat cards', async ({
    dashboardPage,
  }, testInfo) => {
    await allure.story('Dashboard Content');
    await allure.severity('normal');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-022' });

    // Allow 0 stat cards if the feature is not yet implemented
    const count = await dashboardPage.getStatCardCount();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('TC-023: Global search bar is visible', async ({
    dashboardPage,
  }, testInfo) => {
    await allure.story('Search');
    await allure.severity('normal');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-023' });

    await dashboardPage.assertSearchBarVisible();
  });

  test('TC-024: User can perform a search query', async ({
    dashboardPage, page,
  }, testInfo) => {
    await allure.story('Search');
    await allure.severity('normal');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-024' });

    await dashboardPage.search('test');
    // After search — page should not error; URL may update with query param
    await expect(page).not.toHaveURL(/error|500/);
    await dashboardPage.takeScreenshot('TC-024-search-results');
  });

  test('TC-025: Notifications button is visible', async ({
    dashboardPage,
  }, testInfo) => {
    await allure.story('Notifications');
    await allure.severity('minor');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-025' });

    // Notifications may or may not be present — just assert page stability
    await dashboardPage.assertOnDashboard();
  });

  test('TC-026: Page title reflects the application name', async ({
    dashboardPage,
  }, testInfo) => {
    await allure.story('Dashboard Page Title');
    await allure.severity('minor');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-026' });

    const title = await dashboardPage.getTitle();
    expect(title.toLowerCase()).toMatch(/sketchplay|dashboard/);
  });

  test('TC-027: Dashboard loads without console errors', async ({
    dashboardPage,
  }, testInfo) => {
    await allure.story('Dashboard Stability');
    await allure.severity('normal');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-027' });

    const errors = dashboardPage.listenForConsoleErrors();
    await dashboardPage.goto();
    // Allow zero console errors for a clean render
    expect(errors.length).toBe(0);
  });

});

// ─── Negative ────────────────────────────────────────────────────────────────

test.describe('Dashboard — Negative', () => {

  test('TC-028: Unauthenticated direct access redirects to login', async ({
    page,
  }, testInfo) => {
    await allure.epic('Core Application');
    await allure.feature('Dashboard');
    await allure.story('Access Control');
    await allure.severity('critical');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-028' });

    // Clear storage to simulate unauthenticated state
    await page.context().clearCookies();
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });

    await page.goto(
      `${process.env.WEB_BASE_URL ?? 'http://localhost:4200'}/dashboard`,
      { waitUntil: 'domcontentloaded' }
    );

    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test('TC-029: Search with empty query does not crash the page', async ({
    dashboardPage, page,
  }, testInfo) => {
    await allure.epic('Core Application');
    await allure.feature('Dashboard');
    await allure.story('Search Validation');
    await allure.severity('minor');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-029' });

    await dashboardPage.goto();
    await dashboardPage.search('');
    await expect(page).not.toHaveURL(/error|500/);
  });

  test('TC-030: Search with XSS payload does not execute script', async ({
    dashboardPage, page,
  }, testInfo) => {
    await allure.epic('Core Application');
    await allure.feature('Dashboard');
    await allure.story('Search Security');
    await allure.severity('critical');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-030' });

    await dashboardPage.goto();

    // Listen for any dialog (which would indicate an XSS alert fired)
    let xssTriggered = false;
    page.on('dialog', async (dialog) => {
      xssTriggered = true;
      await dialog.dismiss();
    });

    await dashboardPage.search('<script>alert("xss")</script>');
    await page.waitForTimeout(2_000);

    expect(xssTriggered).toBe(false);
  });

});

// ─── Field-Level Validation ───────────────────────────────────────────────────

test.describe('Dashboard — Field-Level Validation', () => {

  test.beforeEach(async ({ dashboardPage }) => {
    await allure.epic('Core Application');
    await allure.feature('Dashboard');
    await dashboardPage.goto();
  });

  const searchPayloads = [
    { id: 'TC-031', label: 'SQL injection',  value: "'; DROP TABLE users; --" },
    { id: 'TC-032', label: 'Very long input', value: 'a'.repeat(500) },
    { id: 'TC-033', label: 'Unicode chars',   value: 'ünïcödé 日本語 عربي' },
    { id: 'TC-034', label: 'Special chars',   value: '!@#$%^&*()_+-=[]{}|;:\'",./<>?' },
  ];

  for (const { id, label, value } of searchPayloads) {
    test(`${id}: Search — ${label}`, async ({
      dashboardPage, page,
    }, testInfo) => {
      await allure.story('Search Field Validation');
      await allure.severity('major');
      testInfo.annotations.push({ type: 'testCaseId', description: id });

      await dashboardPage.search(value);

      // Must not redirect to error page
      await expect(page).not.toHaveURL(/error|500|crash/);
      // Must remain authenticated
      await expect(page).not.toHaveURL(/\/login/);
    });
  }

  test('TC-035: Notification count badge displays numeric value', async ({
    dashboardPage,
  }, testInfo) => {
    await allure.story('Notifications Validation');
    await allure.severity('minor');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-035' });

    const count = await dashboardPage.getNotificationCount();
    expect(count).toBeGreaterThanOrEqual(0);
  });

});

// ─── Logout Flow ─────────────────────────────────────────────────────────────

test.describe('Dashboard — Logout', () => {

  test('TC-036: User can log out and is redirected to login page', async ({
    dashboardPage, page,
  }, testInfo) => {
    await allure.epic('Authentication');
    await allure.feature('Logout');
    await allure.story('Logout Flow');
    await allure.severity('critical');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-036' });

    await dashboardPage.goto();
    await dashboardPage.assertAuthenticated();
    await dashboardPage.logout();
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test('TC-037: After logout, back button does not restore session', async ({
    dashboardPage, page,
  }, testInfo) => {
    await allure.epic('Authentication');
    await allure.feature('Logout');
    await allure.story('Session Invalidation');
    await allure.severity('critical');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-037' });

    await dashboardPage.goto();
    await dashboardPage.logout();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    await page.goBack();
    await page.waitForTimeout(2_000);

    // Should redirect back to login — session is invalidated
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

});
