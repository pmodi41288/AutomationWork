/**
 * bugLogger.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Autonomous Bug Logger
 *
 * Called automatically by the test fixture on every test failure.
 * Responsibilities:
 *   1. Build a structured bug payload from the Playwright failure context
 *   2. Create a linked Bug work item in Azure DevOps under the parent User Story
 *   3. Upload failure screenshot and video as attachments to the Bug
 *   4. Return the created Bug work item ID for Allure linking
 */

import * as os from 'os';
import * as path from 'path';
import dayjs from 'dayjs';
import { AzureDevOpsClient } from '../clients/azureDevOps.client';
import { BugPayload, CreatedBug } from '../types/index';
import {
  AZURE_DEVOPS_AREA_PATH,
  AZURE_DEVOPS_ITERATION_PATH,
  AZURE_DEVOPS_ORG_URL,
  AZURE_DEVOPS_PROJECT,
} from '../../config/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BugLogInput {
  /** Human-readable test title from Playwright */
  testTitle:      string;
  /** Absolute path to the spec file */
  testFile:       string;
  /** Playwright assertion error message */
  errorMessage:   string;
  /** Full stack trace */
  errorStack:     string;
  /** The parent User Story ID this test belongs to */
  parentStoryId:  number;
  /** Absolute path to the failure screenshot (optional) */
  screenshotPath?: string;
  /** Absolute path to the failure video (optional) */
  videoPath?:      string;
  /** ISO timestamp of the test run */
  runDate:         string;
  /** Browser/project name */
  browser:         string;
  /** Target URL that was being tested */
  targetUrl?:      string;
  /** Test Case ID (e.g. TC-001) */
  testCaseId?:     string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function buildBugTitle(input: BugLogInput): string {
  // Format: [Auto-Bug] <Test Title> - Failure on <Page/URL>
  const location = input.targetUrl
    ? new URL(input.targetUrl).pathname
    : path.basename(input.testFile, '.spec.ts');

  const title = `[Auto-Bug] ${truncate(input.testTitle, 80)} - Failure on ${location}`;
  return title;
}

function buildDescription(input: BugLogInput): string {
  return [
    `<h3>Automated Bug Report</h3>`,
    `<p>This bug was automatically created by <strong>sketchplay-qa-agent</strong> `,
    `following a test failure detected at <strong>${input.runDate}</strong>.</p>`,
    `<h4>Test Context</h4>`,
    `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">`,
    `  <tr><td><b>Test Title</b></td><td>${input.testTitle}</td></tr>`,
    `  <tr><td><b>Test File</b></td><td>${input.testFile}</td></tr>`,
    input.testCaseId
      ? `  <tr><td><b>Test Case ID</b></td><td>${input.testCaseId}</td></tr>` : '',
    `  <tr><td><b>Browser</b></td><td>${input.browser}</td></tr>`,
    input.targetUrl
      ? `  <tr><td><b>Target URL</b></td><td>${input.targetUrl}</td></tr>` : '',
    `  <tr><td><b>Run Date</b></td><td>${input.runDate}</td></tr>`,
    `  <tr><td><b>Parent Story</b></td><td>#${input.parentStoryId}</td></tr>`,
    `</table>`,
  ].filter(Boolean).join('\n');
}

function buildStepsToReproduce(input: BugLogInput): string {
  return [
    `1. Navigate to ${input.targetUrl ?? 'the application URL'}`,
    `2. Authenticate with a valid test account`,
    `3. Execute the test: "${input.testTitle}"`,
    `4. Observe the failure at the assertion point described in the Actual Result`,
    ``,
    `--- Playwright Stack Trace ---`,
    truncate(input.errorStack, 3000),
  ].join('\n');
}

function buildSystemInfo(input: BugLogInput): string {
  return [
    `Browser:     ${input.browser}`,
    `OS:          ${os.type()} ${os.release()} (${os.arch()})`,
    `Node.js:     ${process.version}`,
    `Framework:   Playwright`,
    `Timestamp:   ${input.runDate}`,
    `Spec File:   ${input.testFile}`,
    `CI:          ${process.env.CI ?? 'false'}`,
    `Build:       ${process.env.BUILD_BUILDID ?? 'local'}`,
  ].join('\n');
}

// ─── BugLogger ────────────────────────────────────────────────────────────────

/**
 * BugLogger
 *
 * Instantiated by the test fixture on failure. Builds the complete
 * Bug work item payload and delegates creation to AzureDevOpsClient.
 */
export class BugLogger {
  private readonly client: AzureDevOpsClient;

  constructor() {
    this.client = new AzureDevOpsClient();
  }

  /**
   * Main entry point: creates a Bug in Azure DevOps and returns the Bug ID.
   * Returns null if Azure DevOps is not configured or creation fails.
   */
  async logBug(input: BugLogInput): Promise<number | null> {
    if (!AZURE_DEVOPS_ORG_URL || !AZURE_DEVOPS_PROJECT) {
      console.warn('[BugLogger] Azure DevOps not configured — skipping bug creation.');
      return null;
    }

    if (input.parentStoryId <= 0) {
      console.warn('[BugLogger] No valid parentStoryId provided — skipping bug creation.');
      return null;
    }

    console.log(
      `\n[BugLogger] Creating bug for test failure: "${truncate(input.testTitle, 60)}"`
    );

    const payload: BugPayload = {
      title:            buildBugTitle(input),
      description:      buildDescription(input),
      stepsToReproduce: buildStepsToReproduce(input),
      actualResult:     `Test failed with error:\n\n${truncate(input.errorMessage, 2000)}`,
      expectedResult:   `Test "${input.testTitle}" should pass without errors.`,
      systemInfo:       buildSystemInfo(input),
      parentStoryId:    input.parentStoryId,
      areaPath:         AZURE_DEVOPS_AREA_PATH,
      iterationPath:    AZURE_DEVOPS_ITERATION_PATH,
    };

    try {
      const bug: CreatedBug = await this.client.createBug(
        payload,
        input.screenshotPath,
        input.videoPath
      );

      console.log(`[BugLogger] Bug created: #${bug.id} — ${bug.title}`);
      console.log(`[BugLogger] URL: ${bug.url}`);
      if (bug.attachmentUrls.length > 0) {
        console.log(`[BugLogger] Attachments uploaded: ${bug.attachmentUrls.length}`);
      }

      // Post a comment back to the parent User Story so it's visible there too
      await this.notifyParentStory(input.parentStoryId, bug, input);

      return bug.id;

    } catch (err) {
      console.error(`[BugLogger] Failed to create bug: ${(err as Error).message}`);
      return null;
    }
  }

  // ─── Notify Parent Story ──────────────────────────────────────────────────

  private async notifyParentStory(
    storyId: number,
    bug: CreatedBug,
    input: BugLogInput
  ): Promise<void> {
    const bugUrl = `${AZURE_DEVOPS_ORG_URL}/${AZURE_DEVOPS_PROJECT}/_workitems/edit/${bug.id}`;

    const commentHtml = `
<h3>🐛 Automated Test Failure — Bug Auto-Created</h3>
<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">
  <tr style="background:#C62828;color:#fff;">
    <th colspan="2">Test Failure Report — ${input.runDate}</th>
  </tr>
  <tr><td><b>Test</b></td><td>${input.testTitle}</td></tr>
  <tr><td><b>Browser</b></td><td>${input.browser}</td></tr>
  <tr><td><b>Error</b></td><td><pre>${truncate(input.errorMessage, 500)}</pre></td></tr>
  <tr><td><b>Bug Created</b></td>
    <td><a href="${bugUrl}">Bug #${bug.id}: ${bug.title}</a></td>
  </tr>
  ${bug.attachmentUrls.length > 0
    ? `<tr><td><b>Attachments</b></td><td>${bug.attachmentUrls.length} file(s) uploaded to Bug #${bug.id}</td></tr>`
    : ''
  }
</table>
<p><small>Auto-generated by <strong>sketchplay-qa-agent v1.0</strong></small></p>
    `.trim();

    try {
      await this.client.addComment(storyId, commentHtml);
    } catch (e) {
      console.warn(`[BugLogger] Could not comment on parent story: ${(e as Error).message}`);
    }
  }

  // ─── Batch Log ────────────────────────────────────────────────────────────

  /**
   * Logs multiple bugs from an array of failure inputs.
   * Returns a map of testTitle → bug ID (or null on failure).
   */
  async logBugs(
    inputs: BugLogInput[]
  ): Promise<Map<string, number | null>> {
    const results = new Map<string, number | null>();

    for (const input of inputs) {
      // Brief delay to avoid ADO rate limits
      await new Promise((r) => setTimeout(r, 500));
      const id = await this.logBug(input);
      results.set(input.testTitle, id);
    }

    return results;
  }
}

/** Pre-built singleton for direct import */
export const bugLogger = new BugLogger();
