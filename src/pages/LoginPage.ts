import { Page } from '@playwright/test';
import * as allure from 'allure-js-commons';
import { BasePage } from './BasePage';
import { WEB_BASE_URL } from '../../config/env';

/**
 * LoginPage
 *
 * Encapsulates all interactions with the Sketchplay web portal login page.
 * Extends BasePage to inherit self-healing locators and Allure step wrapping.
 *
 * Self-healing locator cascade:
 *   Primary   → data-testid (most stable)
 *   Fallback1 → CSS type/name selector
 *   Fallback2 → ARIA role + visible name
 *   Fallback3 → label text association
 *   Fallback4 → placeholder text
 */
export class LoginPage extends BasePage {
  protected readonly path              = '/login';
  protected readonly pageLoadedSelector = 'form';

  // ─── Locator Definitions ────────────────────────────────────────────────────

  private get emailInput() {
    return this.find(
      'input[type="email"]',
      {
        testId:      'email-input',
        role:        'textbox:Email',
        label:       'Email',
        placeholder: 'email',
      }
    );
  }

  private get passwordInput() {
    return this.find(
      'input[type="password"]',
      {
        testId:      'password-input',
        label:       'Password',
        placeholder: 'password',
      }
    );
  }

  private get submitButton() {
    return this.find(
      'button[type="submit"]',
      {
        testId: 'login-button',
        role:   'button:Sign in',
        text:   'Sign in',
      }
    );
  }

  private get errorMessage() {
    return this.find(
      '[data-testid="login-error"]',
      {
        role: 'alert',
        text: 'Invalid',
      }
    );
  }

  private get forgotPasswordLink() {
    return this.find(
      'a[href*="forgot"]',
      {
        testId: 'forgot-password-link',
        role:   'link:Forgot password',
        text:   'Forgot',
      }
    );
  }

  private get rememberMeCheckbox() {
    return this.find(
      'input[type="checkbox"][name*="remember"]',
      {
        testId: 'remember-me',
        label:  'Remember me',
      }
    );
  }

  private get signUpLink() {
    return this.find(
      'a[href*="register"], a[href*="sign-up"]',
      { text: 'Sign up' }
    );
  }

  private get pageHeading() {
    return this.find(
      'h1, h2',
      { testId: 'login-heading' }
    );
  }

  private get loadingSpinner() {
    return this.find(
      '[data-testid="loading-spinner"], .spinner, [aria-label*="loading" i]',
      {}
    );
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  /**
   * Navigates to the login page and waits for the form to be visible.
   */
  async goto(): Promise<void> {
    await allure.step('Navigate to Login page', async () => {
      await this.page.goto(`${WEB_BASE_URL}${this.path}`, {
        waitUntil: 'domcontentloaded',
      });
      await this.waitForPageLoad();
      await this.assertVisible(await this.emailInput, 'Email input should be visible');
    });
  }

  /**
   * Fills the email field.
   */
  async enterEmail(email: string): Promise<void> {
    await this.fill(
      { strategy: 'css', value: 'input[type="email"]' },
      email,
      [
        { strategy: 'data-testid', value: 'email-input' },
        { strategy: 'label',       value: 'Email' },
      ],
      { label: 'Email field' }
    );
  }

  /**
   * Fills the password field. Masked in Allure output.
   */
  async enterPassword(password: string): Promise<void> {
    await this.fill(
      { strategy: 'css', value: 'input[type="password"]' },
      password,
      [
        { strategy: 'data-testid', value: 'password-input' },
        { strategy: 'label',       value: 'Password' },
      ],
      { label: 'Password field', secret: true }
    );
  }

  /**
   * Clicks the submit button and waits for navigation.
   */
  async clickSignIn(): Promise<void> {
    await this.click(
      { strategy: 'css', value: 'button[type="submit"]' },
      [
        { strategy: 'data-testid', value: 'login-button' },
        { strategy: 'role',        value: 'button:Sign in' },
        { strategy: 'text',        value: 'Sign in' },
      ],
      { label: 'Sign in button' }
    );
  }

  /**
   * Complete login flow: enter credentials and submit.
   * Waits for the loading state to clear before returning.
   */
  async login(email: string, password: string): Promise<void> {
    await allure.step(`Login as "${email}"`, async () => {
      await this.enterEmail(email);
      await this.enterPassword(password);
      await this.clickSignIn();

      // Wait for navigation away from login page
      await this.page.waitForURL(
        (url) => !url.pathname.includes('/login'),
        { timeout: 20_000 }
      );
      await this.waitForNetworkIdle();
    });
  }

  /**
   * Attempts login with invalid credentials — used for negative test cases.
   * Does NOT assert navigation; caller handles assertions.
   */
  async attemptLogin(email: string, password: string): Promise<void> {
    await allure.step(`Attempt login with email="${email}"`, async () => {
      await this.enterEmail(email);
      await this.enterPassword(password);
      await this.clickSignIn();
      // Wait briefly for error to appear
      await this.page.waitForTimeout(1_500);
    });
  }

  /**
   * Checks the "Remember me" checkbox.
   */
  async checkRememberMe(): Promise<void> {
    await this.setChecked(
      { strategy: 'css', value: 'input[type="checkbox"][name*="remember"]' },
      true,
      [{ strategy: 'data-testid', value: 'remember-me' }]
    );
  }

  /**
   * Clicks the "Forgot password" link.
   */
  async clickForgotPassword(): Promise<void> {
    await this.click(
      { strategy: 'css', value: 'a[href*="forgot"]' },
      [
        { strategy: 'data-testid', value: 'forgot-password-link' },
        { strategy: 'text',        value: 'Forgot' },
      ],
      { label: 'Forgot password link' }
    );
  }

  /**
   * Clicks the "Sign up" link.
   */
  async clickSignUp(): Promise<void> {
    await this.click(
      { strategy: 'text', value: 'Sign up' },
      [{ strategy: 'data-testid', value: 'sign-up-link' }],
      { label: 'Sign up link' }
    );
  }

  // ─── Assertions ─────────────────────────────────────────────────────────────

  async assertOnLoginPage(): Promise<void> {
    await allure.step('Assert: on Login page', async () => {
      await this.assertUrl(/\/login/);
      await this.assertVisible(await this.emailInput,    'Email input visible');
      await this.assertVisible(await this.passwordInput, 'Password input visible');
      await this.assertVisible(await this.submitButton,  'Submit button visible');
    });
  }

  async assertErrorMessage(expectedText?: string): Promise<void> {
    await allure.step('Assert: error message shown', async () => {
      const el = await this.errorMessage;
      await this.assertVisible(el, 'Error message should be visible');
      if (expectedText) {
        await this.assertContainsText(el, expectedText);
      }
    });
  }

  async assertNoErrorMessage(): Promise<void> {
    await allure.step('Assert: no error message shown', async () => {
      await this.assertNotVisible(await this.errorMessage, 'No error message should be visible');
    });
  }

  async assertPageTitle(expected: string | RegExp): Promise<void> {
    await this.assertTitle(expected);
  }

  async assertForgotPasswordLinkVisible(): Promise<void> {
    await this.assertVisible(await this.forgotPasswordLink, 'Forgot password link visible');
  }

  async assertSignUpLinkVisible(): Promise<void> {
    await this.assertVisible(await this.signUpLink, 'Sign up link visible');
  }

  /**
   * Asserts that the user was successfully redirected away from the login page.
   * Used to verify successful authentication.
   */
  async assertLoginSuccess(): Promise<void> {
    await allure.step('Assert: login successful (redirected from /login)', async () => {
      await this.page.waitForURL(
        (url) => !url.pathname.includes('/login'),
        { timeout: 15_000 }
      );
      await this.assertUrl(/^(?!.*\/login)/);
    });
  }

  /**
   * Asserts that the user remains on the login page (login failed).
   */
  async assertLoginFailure(): Promise<void> {
    await allure.step('Assert: login failed (still on /login)', async () => {
      await this.assertUrl(/\/login/);
      await this.assertErrorMessage();
    });
  }

  // ─── Utilities ──────────────────────────────────────────────────────────────

  /**
   * Clears both credential fields.
   */
  async clearCredentials(): Promise<void> {
    await (await this.emailInput).clear();
    await (await this.passwordInput).clear();
  }

  /**
   * Returns the current value of the email input.
   */
  async getEmailValue(): Promise<string> {
    return (await (await this.emailInput).inputValue()) ?? '';
  }

  /**
   * Checks whether the submit button is enabled.
   */
  async isSubmitEnabled(): Promise<boolean> {
    return (await this.submitButton).then((l) => l.isEnabled());
  }
}
