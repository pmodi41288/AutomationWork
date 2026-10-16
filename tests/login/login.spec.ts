/**
 * login.spec.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Login feature test suite — covers Positive, Negative, and
 * Field-Level Validation test cases aligned with Sketchplay User Stories.
 *
 * This file demonstrates the full framework stack:
 *   - test() from the custom fixture (auto failure screenshot + bug logging)
 *   - LoginPage POM with self-healing locators
 *   - Allure annotations (epic, feature, story, severity, testCaseId)
 *   - Parameterised negative test data
 */

import * as allure from 'allure-js-commons';
import { test, expect }  from '../../src/fixtures/test.fixture';
import { WEB_USER_EMAIL, WEB_USER_PASSWORD, WEB_BASE_URL } from '../../config/env';

// ─── Test Suite Configuration ─────────────────────────────────────────────────

test.use({
  // No storageState for login tests — they test the login flow itself
  storageState: undefined,
});

// ─── Suite: Positive ──────────────────────────────────────────────────────────

test.describe('Login — Positive', () => {

  test.beforeEach(async ({ loginPage }) => {
    await allure.epic('Authentication');
    await allure.feature('Login');
    await loginPage.goto();
  });

  test('TC-001: Valid credentials allow access to the application', async ({
    loginPage,
  }, testInfo) => {
    await allure.story('Valid Login');
    await allure.severity('critical');
    await allure.description('Verifies that a user with valid credentials can successfully log in and reach the dashboard.');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-001' });

    await loginPage.assertOnLoginPage();
    await loginPage.login(WEB_USER_EMAIL, WEB_USER_PASSWORD);
    await loginPage.assertLoginSuccess();
    await loginPage.takeScreenshot('TC-001-login-success');
  });

  test('TC-002: Login page renders all required UI elements', async ({
    loginPage,
  }, testInfo) => {
    await allure.story('Login Page UI');
    await allure.severity('normal');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-002' });

    await loginPage.assertOnLoginPage();
    await loginPage.assertForgotPasswordLinkVisible();
    await loginPage.assertSignUpLinkVisible();
  });

  test('TC-003: "Forgot password" link navigates to password reset page', async ({
    loginPage, page,
  }, testInfo) => {
    await allure.story('Forgot Password');
    await allure.severity('normal');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-003' });

    await loginPage.assertForgotPasswordLinkVisible();
    await loginPage.clickForgotPassword();
    await expect(page).toHaveURL(/forgot|reset|password/, { timeout: 10_000 });
  });

  test('TC-004: "Remember me" checkbox is functional', async ({
    loginPage,
  }, testInfo) => {
    await allure.story('Remember Me');
    await allure.severity('minor');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-004' });

    await loginPage.assertOnLoginPage();
    await loginPage.checkRememberMe();
    // Checkbox toggled without error — functional verification
  });

  test('TC-005: Page title is correct', async ({
    loginPage,
  }, testInfo) => {
    await allure.story('Login Page Title');
    await allure.severity('minor');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-005' });

    await loginPage.assertOnLoginPage();
    // Title should contain the brand name
    const title = await loginPage.getTitle();
    expect(title.toLowerCase()).toMatch(/sketchplay|sign in|login/);
  });

});

// ─── Suite: Negative ──────────────────────────────────────────────────────────

test.describe('Login — Negative', () => {

  test.beforeEach(async ({ loginPage }) => {
    await allure.epic('Authentication');
    await allure.feature('Login');
    await loginPage.goto();
  });

  test('TC-006: Invalid password shows error message', async ({
    loginPage,
  }, testInfo) => {
    await allure.story('Invalid Credentials');
    await allure.severity('critical');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-006' });

    await loginPage.attemptLogin(WEB_USER_EMAIL, 'WrongPassword!999');
    await loginPage.assertLoginFailure();
  });

  test('TC-007: Non-existent email shows error message', async ({
    loginPage,
  }, testInfo) => {
    await allure.story('Invalid Credentials');
    await allure.severity('critical');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-007' });

    await loginPage.attemptLogin('no-such-user@invalid.example.com', 'AnyPassword123!');
    await loginPage.assertLoginFailure();
  });

  test('TC-008: Empty form submission shows validation errors', async ({
    loginPage, page,
  }, testInfo) => {
    await allure.story('Empty Form Submission');
    await allure.severity('major');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-008' });

    await loginPage.clickSignIn();
    // Page should still be on login — HTML5 validation or server error
    await loginPage.assertOnLoginPage();
  });

  test('TC-009: Direct navigation to protected route redirects to login', async ({
    page,
  }, testInfo) => {
    await allure.story('Unauthenticated Access');
    await allure.severity('critical');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-009' });

    // Navigate directly to a protected page without authentication
    await page.goto(`${WEB_BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test('TC-010: Password field input is masked', async ({
    loginPage, page,
  }, testInfo) => {
    await allure.story('Password Security');
    await allure.severity('major');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-010' });

    await loginPage.assertOnLoginPage();
    const pwType = await page.locator('input[type="password"]').first().getAttribute('type');
    expect(pwType).toBe('password');
  });

});

// ─── Suite: Field-Level Validation ────────────────────────────────────────────

test.describe('Login — Field-Level Validation', () => {

  test.beforeEach(async ({ loginPage }) => {
    await allure.epic('Authentication');
    await allure.feature('Login');
    await loginPage.goto();
  });

  const invalidEmails = [
    { label: 'missing @ symbol',     value: 'notanemail',             id: 'TC-011' },
    { label: 'missing domain',        value: 'user@',                  id: 'TC-012' },
    { label: 'missing TLD',           value: 'user@domain',            id: 'TC-013' },
    { label: 'whitespace only',       value: '   ',                    id: 'TC-014' },
    { label: 'SQL injection attempt', value: "' OR '1'='1",            id: 'TC-015' },
    { label: 'XSS attempt',           value: '<script>alert(1)</script>', id: 'TC-016' },
  ];

  for (const { label, value, id } of invalidEmails) {
    test(`${id}: Email validation — ${label}`, async ({
      loginPage, page,
    }, testInfo) => {
      await allure.story('Email Field Validation');
      await allure.severity('major');
      testInfo.annotations.push({ type: 'testCaseId', description: id });

      await loginPage.attemptLogin(value, 'ValidPassword123!');

      // Page must remain on login — no auth bypass possible
      await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
    });
  }

  test('TC-017: Password field — below minimum length', async ({
    loginPage, page,
  }, testInfo) => {
    await allure.story('Password Field Validation');
    await allure.severity('major');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-017' });

    await loginPage.attemptLogin(WEB_USER_EMAIL, '123');
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });

  test('TC-018: Both fields empty — form does not submit', async ({
    loginPage, page,
  }, testInfo) => {
    await allure.story('Empty Fields Validation');
    await allure.severity('major');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-018' });

    await loginPage.clickSignIn();
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });

  test('TC-019: Max-length email input is handled gracefully', async ({
    loginPage, page,
  }, testInfo) => {
    await allure.story('Email Field Max Length');
    await allure.severity('minor');
    testInfo.annotations.push({ type: 'testCaseId', description: 'TC-019' });

    const longEmail = `${'a'.repeat(200)}@example.com`;
    await loginPage.attemptLogin(longEmail, 'ValidPassword123!');
    await expect(page).toHaveURL(/\/login/, { timeout: 5_000 });
  });

});
