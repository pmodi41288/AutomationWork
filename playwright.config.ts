import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Auth state file paths
export const WEB_AUTH_FILE = path.resolve(__dirname, '.auth/web-user.json');
export const MOTHERSHIP_AUTH_FILE = path.resolve(__dirname, '.auth/mothership-user.json');

/**
 * Playwright Configuration
 * Enterprise-grade config with multi-project browser matrix,
 * global setup/teardown, Allure reporting, and video/screenshot capture.
 */
export default defineConfig({
  // ─── Test Discovery ────────────────────────────────────────────────────────
  testDir: './tests',
  testMatch: ['**/*.spec.ts'],
  snapshotDir: './test-artifacts/snapshots',

  // ─── Parallelism ───────────────────────────────────────────────────────────
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 2 : 0,

  // ─── Timeouts ──────────────────────────────────────────────────────────────
  timeout: 60_000,          // Per-test timeout
  expect: {
    timeout: 15_000,        // Per-assertion timeout
  },

  // ─── Reporters ─────────────────────────────────────────────────────────────
  reporter: [
    ['list', { printSteps: true }],
    ['html', {
      outputFolder: 'playwright-report',
      open: process.env.CI ? 'never' : 'on-failure',
    }],
    ['allure-playwright', {
      resultsDir: 'allure-results',
      detail: true,
      suiteTitle: false,
      links: {
        issue: {
          nameTemplate: 'Issue #%s',
          urlTemplate: `${process.env.AZURE_DEVOPS_ORG_URL}/${process.env.AZURE_DEVOPS_PROJECT}/_workitems/edit/%s`,
        },
        tms: {
          nameTemplate: 'TC-%s',
          urlTemplate: `${process.env.AZURE_DEVOPS_ORG_URL}/${process.env.AZURE_DEVOPS_PROJECT}/_workitems/edit/%s`,
        },
      },
      environmentInfo: {
        FRAMEWORK:       'Playwright',
        LANGUAGE:        'TypeScript',
        NODE_VERSION:    process.version,
        ENVIRONMENT:     process.env.TEST_ENV ?? 'dev',
        BASE_URL:        process.env.WEB_BASE_URL ?? '',
        MOTHERSHIP_URL:  process.env.MOTHERSHIP_BASE_URL ?? '',
        CI:              process.env.CI ?? 'false',
      },
    }],
    // Custom failure reporter runs as a post-step via test hooks in fixtures
  ],

  // ─── Global Setup / Teardown ───────────────────────────────────────────────
  globalSetup: path.resolve(__dirname, 'src/setup/global-setup.ts'),
  globalTeardown: path.resolve(__dirname, 'src/setup/global-teardown.ts'),

  // ─── Output Directories ────────────────────────────────────────────────────
  outputDir: 'test-artifacts/playwright-output',

  // ─── Shared Browser Context Defaults ──────────────────────────────────────
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:4200',

    // Trace: captures on first retry in CI, always on locally if debug
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',

    // Screenshots: captured on failure always; saves to test-artifacts
    screenshot: {
      mode: 'on',
      fullPage: true,
    },

    // Video: record on first retry to keep storage manageable
    video: process.env.CI ? 'on-first-retry' : 'retain-on-failure',

    // Viewport
    viewport: { width: 1440, height: 900 },

    // Navigation timeout
    navigationTimeout: 30_000,
    actionTimeout: 15_000,

    // Locale
    locale: 'en-US',
    timezoneId: 'America/New_York',

    // Ignore HTTPS errors in dev/stage
    ignoreHTTPSErrors: process.env.TEST_ENV !== 'production',

    // Extra HTTP headers
    extraHTTPHeaders: {
      'x-qa-agent': 'sketchplay-qa-agent/1.0',
    },
  },

  // ─── Projects ──────────────────────────────────────────────────────────────
  projects: [
    // ── Auth Setup Projects (always run first) ──────────────────────────────
    {
      name: 'web:auth-setup',
      testMatch: '**/auth/web.setup.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mothership:auth-setup',
      testMatch: '**/auth/mothership.setup.ts',
      use: { ...devices['Desktop Chrome'] },
    },

    // ── Desktop Chromium ────────────────────────────────────────────────────
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: WEB_AUTH_FILE,
        launchOptions: {
          args: ['--disable-web-security', '--disable-features=IsolateOrigins'],
        },
      },
      dependencies: ['web:auth-setup'],
    },

    // ── Desktop Firefox ─────────────────────────────────────────────────────
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        storageState: WEB_AUTH_FILE,
      },
      dependencies: ['web:auth-setup'],
    },

    // ── Desktop WebKit ──────────────────────────────────────────────────────
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        storageState: WEB_AUTH_FILE,
      },
      dependencies: ['web:auth-setup'],
    },

    // ── Mothership Portal ───────────────────────────────────────────────────
    {
      name: 'mothership',
      testMatch: '**/mothership/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.MOTHERSHIP_BASE_URL ?? 'http://localhost:4300',
        storageState: MOTHERSHIP_AUTH_FILE,
      },
      dependencies: ['mothership:auth-setup'],
    },

    // ── Mobile Chrome (responsive) ──────────────────────────────────────────
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        storageState: WEB_AUTH_FILE,
      },
      dependencies: ['web:auth-setup'],
    },

    // ── Unauthenticated project for login tests ──────────────────────────────
    {
      name: 'login-tests',
      testMatch: '**/login/**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // No storageState — tests handle authentication themselves
      },
    },
  ],
});
