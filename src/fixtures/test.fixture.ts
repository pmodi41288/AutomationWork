/**
 * test.fixture.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Master fixture that all test files should import instead of @playwright/test.
 *
 * Provides:
 *   - All auth fixtures (authenticatedPage, mothershipPage, etc.)
 *   - Pre-instantiated page objects (loginPage, dashboardPage)
 *   - Automatic screenshot + Allure attachment on test failure
 *   - Automatic bug creation in Azure DevOps on failure (when ADO is configured)
 *   - Allure metadata injection (test case ID, story link, labels)
 */

import { test as base, expect, Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as allure from 'allure-js-commons';
import dayjs from 'dayjs';

import { authTest } from './auth.fixture';
import { LoginPage }     from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { screenshotHelper } from '../utils/screenshot.helper';
import { SCREENSHOTS_DIR, VIDEOS_DIR } from '../../config/env';

function redactSensitiveUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|secret|password|session|auth|key|code/i.test(key)) {
        parsed.searchParams.set(key, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

// ─── Fixture Types ────────────────────────────────────────────────────────────

type PageObjects = {
  loginPage:     LoginPage;
  dashboardPage: DashboardPage;
};

type MetaFixtures = {
  /** Azure DevOps Story ID to link this test to */
  storyId:    number;
  /** Test Case ID (e.g. TC-001) for Allure/Excel tracing */
  testCaseId: string;
  /** Comma-separated AC references for a mapped test (e.g. AC1,AC2). */
  acceptanceCriterionIds: string;
};

type QAFixtures = PageObjects & MetaFixtures & {
  /** Convenience: current authenticated page (alias for authenticatedPage) */
  qaPage: Page;
};

// ─── Combined Test ────────────────────────────────────────────────────────────

export const test = authTest.extend<QAFixtures>({

  // ── Default metadata (overrideable per test) ────────────────────────────────
  storyId:    [0,   { option: true }],
  testCaseId: ['',  { option: true }],
  acceptanceCriterionIds: ['', { option: true }],

  // ── Convenience alias ───────────────────────────────────────────────────────
  qaPage: async ({ authenticatedPage }, use) => {
    await use(authenticatedPage);
  },

  // ── Page Objects ─────────────────────────────────────────────────────────────
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  dashboardPage: async ({ authenticatedPage }, use) => {
    await use(new DashboardPage(authenticatedPage));
  },

  // ── Core Page with Failure Hooks ────────────────────────────────────────────

  page: async ({ page, storyId, testCaseId, acceptanceCriterionIds }, use, testInfo) => {

    // ── Allure metadata ──────────────────────────────────────────────────────
    await allure.label('framework', 'Playwright');
    await allure.label('language', 'TypeScript');
    await allure.label('testCaseId', testCaseId || testInfo.title);
    if (acceptanceCriterionIds) {
      testInfo.annotations.push({
        type: 'acceptanceCriterionIds',
        description: acceptanceCriterionIds,
      });
    }

    if (storyId > 0) {
      await allure.issue(String(storyId), `User Story #${storyId}`);
      await allure.tms(String(storyId), `Story #${storyId}`);
      await allure.label('storyId', String(storyId));
    }

    // ── Run the test ─────────────────────────────────────────────────────────
    await use(page);
    const actualUrl = page.url();
    if (actualUrl) {
      testInfo.annotations.push({
        type: 'actualUrl',
        description: redactSensitiveUrl(actualUrl),
      });
    }

    // ── Post-test: handle failures ───────────────────────────────────────────
    if (testInfo.status !== testInfo.expectedStatus) {
      const runDate   = dayjs().format('YYYY-MM-DD HH:mm:ss');
      const safeName  = testInfo.title
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 60);

      // ── Full-page screenshot ─────────────────────────────────────────────
      let screenshotPath: string | undefined;
      try {
        screenshotPath = path.join(
          SCREENSHOTS_DIR,
          `FAIL_${safeName}_${dayjs().format('YYYYMMDD_HHmmss')}.png`
        );
        const buffer = await page.screenshot({ fullPage: true });
        fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
        fs.writeFileSync(screenshotPath, buffer);

        // Attach to Allure
        await allure.attachment('Failure Screenshot', buffer, 'image/png');
        await testInfo.attach('failure-screenshot', { body: buffer, contentType: 'image/png' });

        console.log(`[fixture] Failure screenshot: ${screenshotPath}`);
      } catch (e) {
        console.warn(`[fixture] Screenshot failed: ${(e as Error).message}`);
      }

      // ── Video path ───────────────────────────────────────────────────────
      let videoPath: string | undefined;
      try {
        const video = page.video();
        if (video) {
          // Playwright saves video after page.close() — capture path now
          videoPath = await video.path();
          if (videoPath && fs.existsSync(videoPath)) {
            const videoBuffer = fs.readFileSync(videoPath);
            await allure.attachment('Failure Video', videoBuffer, 'video/webm');
          }
        }
      } catch (e) {
        console.warn(`[fixture] Video capture failed: ${(e as Error).message}`);
      }

      // ── Allure: attach error details ─────────────────────────────────────
      if (testInfo.error) {
        const errorText = [
          `Message: ${testInfo.error.message ?? 'No message'}`,
          `Stack:   ${testInfo.error.stack  ?? 'No stack trace'}`,
        ].join('\n');
        await allure.attachment('Error Details', Buffer.from(errorText), 'text/plain');
      }

      // ── Autonomous Bug Creation ───────────────────────────────────────────
      // Deferred import to avoid loading ADO client in environments without PAT
      if (process.env.AZURE_DEVOPS_PAT && storyId > 0) {
        try {
          const { BugLogger } = await import('../agents/bugLogger.js');
          const bugLogger     = new BugLogger();

          const bugId = await bugLogger.logBug({
            testTitle:      testInfo.title,
            testFile:       testInfo.file,
            errorMessage:   testInfo.error?.message ?? 'Test failed',
            errorStack:     testInfo.error?.stack   ?? '',
            parentStoryId:  storyId,
            screenshotPath,
            videoPath,
            runDate,
            browser:        testInfo.project?.name ?? 'chromium',
          });

          if (bugId) {
            await allure.link(
              `${process.env.AZURE_DEVOPS_ORG_URL}/${process.env.AZURE_DEVOPS_PROJECT}/_workitems/edit/${bugId}`,
              `Bug #${bugId}`,
              'issue'
            );
            console.log(`[fixture] Bug created: #${bugId}`);
          }
        } catch (e) {
          console.warn(`[fixture] Bug creation failed: ${(e as Error).message}`);
        }
      }
    }
  },
});

export { expect };

// Re-export page objects for convenience
export { LoginPage, DashboardPage };
