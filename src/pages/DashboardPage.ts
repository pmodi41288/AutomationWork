import { Page } from '@playwright/test';
import * as allure from 'allure-js-commons';
import { BasePage } from './BasePage';
import { WEB_BASE_URL } from '../../config/env';

/**
 * DashboardPage
 *
 * Encapsulates interactions with the main authenticated dashboard.
 * Serves as the landing page post-login and the navigation hub.
 */
export class DashboardPage extends BasePage {
  protected readonly path               = '/dashboard';
  protected readonly pageLoadedSelector = '[data-testid="dashboard"], main, .dashboard';

  // ─── Locator Definitions ────────────────────────────────────────────────────

  private get userMenuButton() {
    return this.find(
      '[data-testid="user-menu"]',
      { role: 'button:Account menu', text: 'Account' }
    );
  }

  private get userDisplayName() {
    return this.find(
      '[data-testid="user-display-name"]',
      { role: 'heading', text: 'Welcome' }
    );
  }

  private get notificationsButton() {
    return this.find(
      '[data-testid="notifications-button"]',
      { role: 'button:Notifications', label: 'Notifications' }
    );
  }

  private get notificationsBadge() {
    return this.find(
      '[data-testid="notifications-badge"]',
      { role: 'status' }
    );
  }

  private get navigationMenu() {
    return this.find(
      'nav[data-testid="main-nav"], nav, [role="navigation"]',
      {}
    );
  }

  private get searchInput() {
    return this.find(
      '[data-testid="global-search"]',
      { role: 'searchbox', placeholder: 'Search', label: 'Search' }
    );
  }

  private get pageHeading() {
    return this.find(
      '[data-testid="page-heading"], h1',
      {}
    );
  }

  private get loadingOverlay() {
    return this.find(
      '[data-testid="loading-overlay"], [aria-label*="loading" i]',
      {}
    );
  }

  private get logoutButton() {
    return this.find(
      '[data-testid="logout-button"]',
      { role: 'button:Log out', text: 'Log out' }
    );
  }

  private get activityFeed() {
    return this.find(
      '[data-testid="activity-feed"]',
      { role: 'list' }
    );
  }

  private get statsCards() {
    return this.page.locator('[data-testid^="stat-card"]');
  }

  private get errorBanner() {
    return this.find(
      '[data-testid="error-banner"], [role="alert"]',
      {}
    );
  }

  // ─── Navigation ─────────────────────────────────────────────────────────────

  /**
   * Navigates to the dashboard and waits for the page to fully load.
   */
  async goto(): Promise<void> {
    await allure.step('Navigate to Dashboard', async () => {
      await this.page.goto(`${WEB_BASE_URL}${this.path}`, {
        waitUntil: 'domcontentloaded',
      });
      await this.waitForPageLoad();
      await this.waitForDashboardReady();
    });
  }

  /**
   * Waits for the dashboard content to be ready (no loading overlay).
   */
  async waitForDashboardReady(): Promise<void> {
    await allure.step('Wait for dashboard content to load', async () => {
      // Wait for loading overlay to disappear if present
      try {
        await this.waitForHidden(
          '[data-testid="loading-overlay"], .loading, [aria-busy="true"]',
          10_000
        );
      } catch { /* overlay may not exist */ }

      // Wait for network to settle
      await this.waitForNetworkIdle(10_000);
    });
  }

  // ─── User Menu ───────────────────────────────────────────────────────────────

  /**
   * Opens the user account dropdown menu.
   */
  async openUserMenu(): Promise<void> {
    await this.click(
      { strategy: 'data-testid', value: 'user-menu' },
      [
        { strategy: 'role', value: 'button:Account menu' },
        { strategy: 'text', value: 'Account' },
      ],
      { label: 'User menu button' }
    );
  }

  /**
   * Logs out via the user menu.
   */
  async logout(): Promise<void> {
    await allure.step('Logout', async () => {
      await this.openUserMenu();
      await this.click(
        { strategy: 'data-testid', value: 'logout-button' },
        [
          { strategy: 'role', value: 'button:Log out' },
          { strategy: 'text', value: 'Log out' },
        ],
        { label: 'Logout button' }
      );
      await this.page.waitForURL(/\/login/, { timeout: 15_000 });
    });
  }

  // ─── Navigation ─────────────────────────────────────────────────────────────

  /**
   * Navigates to a section via the main nav.
   * @param section  Link text or data-testid of the nav item
   */
  async navigateTo(section: string): Promise<void> {
    await allure.step(`Navigate to section: ${section}`, async () => {
      const nav = await this.find(
        `nav a[href*="${section.toLowerCase()}"]`,
        { text: section }
      );
      await nav.click();
      await this.waitForNetworkIdle(10_000);
    });
  }

  // ─── Search ──────────────────────────────────────────────────────────────────

  /**
   * Types a query into the global search input and submits.
   */
  async search(query: string): Promise<void> {
    await allure.step(`Search: "${query}"`, async () => {
      await this.fill(
        { strategy: 'data-testid', value: 'global-search' },
        query,
        [
          { strategy: 'role',        value: 'searchbox' },
          { strategy: 'placeholder', value: 'Search' },
        ],
        { label: 'Global search' }
      );
      await this.pressKey('Enter');
      await this.waitForNetworkIdle(10_000);
    });
  }

  /**
   * Clears the global search input.
   */
  async clearSearch(): Promise<void> {
    await (await this.searchInput).clear();
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  /**
   * Opens the notifications panel.
   */
  async openNotifications(): Promise<void> {
    await this.click(
      { strategy: 'data-testid', value: 'notifications-button' },
      [
        { strategy: 'role',  value: 'button:Notifications' },
        { strategy: 'label', value: 'Notifications' },
      ],
      { label: 'Notifications button' }
    );
  }

  /**
   * Returns the notification count from the badge (0 if no badge).
   */
  async getNotificationCount(): Promise<number> {
    try {
      const text = await (await this.notificationsBadge).textContent();
      return parseInt(text ?? '0', 10) || 0;
    } catch {
      return 0;
    }
  }

  // ─── Content Helpers ──────────────────────────────────────────────────────

  /**
   * Returns the heading text of the current page section.
   */
  async getPageHeading(): Promise<string> {
    return this.getText({ strategy: 'css', value: '[data-testid="page-heading"], h1' });
  }

  /**
   * Returns the count of stat cards displayed on the dashboard.
   */
  async getStatCardCount(): Promise<number> {
    return this.statsCards.count();
  }

  /**
   * Returns the text content of a stat card by its index (0-based).
   */
  async getStatCardText(index: number): Promise<string> {
    return this.statsCards.nth(index).innerText();
  }

  /**
   * Returns all activity feed item texts.
   */
  async getActivityFeedItems(): Promise<string[]> {
    const feed  = await this.activityFeed;
    const items = feed.locator('li, [role="listitem"]');
    const count = await items.count();
    const texts: string[] = [];
    for (let i = 0; i < count; i++) {
      texts.push(await items.nth(i).innerText());
    }
    return texts;
  }

  /**
   * Returns the authenticated user's displayed name.
   */
  async getUserDisplayName(): Promise<string> {
    try {
      return this.getText({ strategy: 'data-testid', value: 'user-display-name' });
    } catch {
      return '';
    }
  }

  // ─── Assertions ─────────────────────────────────────────────────────────────

  async assertOnDashboard(): Promise<void> {
    await allure.step('Assert: on Dashboard page', async () => {
      await this.assertUrl(/\/dashboard/);
      await this.assertVisible(await this.navigationMenu, 'Navigation menu visible');
    });
  }

  async assertAuthenticated(): Promise<void> {
    await allure.step('Assert: user is authenticated', async () => {
      await this.assertUrl((url) => !url.includes('/login'));
      await this.assertVisible(await this.userMenuButton, 'User menu button visible');
    });
  }

  async assertNoErrorBanner(): Promise<void> {
    await allure.step('Assert: no error banner', async () => {
      await this.assertNotVisible(await this.errorBanner, 'No error banner on dashboard');
    });
  }

  async assertUserName(expectedName: string): Promise<void> {
    await allure.step(`Assert: user name is "${expectedName}"`, async () => {
      const el = await this.userDisplayName;
      await this.assertContainsText(el, expectedName);
    });
  }

  async assertStatCardsVisible(minCount = 1): Promise<void> {
    await allure.step(`Assert: at least ${minCount} stat card(s) visible`, async () => {
      const count = await this.statsCards.count();
      if (count < minCount) {
        throw new Error(`Expected at least ${minCount} stat card(s), but found ${count}`);
      }
    });
  }

  async assertSearchBarVisible(): Promise<void> {
    await this.assertVisible(await this.searchInput, 'Global search bar visible');
  }

  async assertNavigationMenuVisible(): Promise<void> {
    await this.assertVisible(await this.navigationMenu, 'Navigation menu visible');
  }
}
