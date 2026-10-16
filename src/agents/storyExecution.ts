import * as path from 'path';
import { TestExecutionRecord, TestResult } from '../types/index';

export interface StoryManifestCase {
  id: string;
  title: string;
  type: string;
  description: string;
  expectedResult: string;
  acceptanceCriteria: Array<{ id: string; text: string }>;
  automationMapping: { specFile: string; testTitle: string } | null;
}

export interface StoryManifest {
  storyId: number;
  storyTitle: string;
  testCases: StoryManifestCase[];
}

interface PlaywrightAttachment {
  name: string;
  path?: string;
  contentType?: string;
}

interface PlaywrightResult {
  status: string;
  duration?: number;
  errors?: Array<{ message?: string; stack?: string }>;
  attachments?: PlaywrightAttachment[];
}

interface PlaywrightTest {
  projectName?: string;
  status?: string;
  duration?: number;
  errors?: Array<{ message?: string; stack?: string }>;
  attachments?: PlaywrightAttachment[];
  annotations?: Array<{ type: string; description?: string }>;
  results?: PlaywrightResult[];
}

interface PlaywrightTestSpec {
  title: string;
  file?: string;
  tests?: PlaywrightTest[];
}

interface PlaywrightSuite {
  title: string;
  file?: string;
  specs?: PlaywrightTestSpec[];
  suites?: PlaywrightSuite[];
}

interface PlaywrightReport {
  suites?: PlaywrightSuite[];
}

export interface MappedTestCase {
  id: string;
  specFile: string;
  testTitle: string;
  acceptanceCriteria: Array<{ id: string; text: string }>;
}

export function validateStoryManifest(value: unknown, storyId: number): StoryManifest {
  if (
    !value ||
    typeof value !== 'object' ||
    !('storyId' in value) ||
    value.storyId !== storyId ||
    !('testCases' in value) ||
    !Array.isArray(value.testCases)
  ) {
    throw new Error(`[runStory] Manifest for Story #${storyId} is missing or invalid. Run analyze:story first.`);
  }

  if (value.testCases.some((testCase) =>
    !testCase ||
    typeof testCase !== 'object' ||
    !('id' in testCase) ||
    typeof testCase.id !== 'string'
  )) {
    throw new Error(`[runStory] Manifest for Story #${storyId} contains an invalid test-case entry.`);
  }

  return value as StoryManifest;
}

export function mappedTestCases(manifest: StoryManifest): MappedTestCase[] {
  const mapped = manifest.testCases.flatMap((testCase) => {
    const mapping = testCase.automationMapping;
    if (!mapping) return [];
    if (
      typeof mapping !== 'object' ||
      typeof mapping.specFile !== 'string' ||
      typeof mapping.testTitle !== 'string' ||
      !Array.isArray(testCase.acceptanceCriteria) ||
      testCase.acceptanceCriteria.length === 0
    ) {
      throw new Error(`[runStory] Invalid Playwright mapping for ${testCase.id}.`);
    }

    const specFile = path.posix.normalize(mapping.specFile.replace(/\\/g, '/'));
    if (
      path.isAbsolute(mapping.specFile) ||
      path.win32.isAbsolute(mapping.specFile) ||
      !specFile.startsWith('tests/') ||
      !specFile.endsWith('.spec.ts') ||
      !mapping.testTitle.trim()
    ) {
      throw new Error(
        `[runStory] Invalid Playwright mapping for ${testCase.id}: ` +
        'specFile must be a relative tests/**/*.spec.ts path using forward slashes and testTitle must be non-empty.'
      );
    }

    return [{
      id: testCase.id,
      specFile,
      testTitle: mapping.testTitle.trim(),
      acceptanceCriteria: testCase.acceptanceCriteria,
    }];
  });

  const ids = new Set<string>();
  const mappingKeys = new Set<string>();
  for (const testCase of mapped) {
    const mappingKey = `${testCase.specFile}\n${testCase.testTitle}`;
    if (ids.has(testCase.id) || mappingKeys.has(mappingKey)) {
      throw new Error('[runStory] Manifest contains duplicate test case IDs or Playwright test mappings.');
    }
    ids.add(testCase.id);
    mappingKeys.add(mappingKey);
  }
  return mapped;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildPlaywrightSelectionArgs(mapped: MappedTestCase[]): string[] {
  if (mapped.length === 0) {
    throw new Error(
      '[runStory] No generated cases have an explicit Playwright mapping. ' +
      'Add a verified specFile and testTitle mapping to the manifest; no unrelated tests were run.'
    );
  }

  const files = [...new Set(mapped.map((testCase) => testCase.specFile))];
  const titlePattern = `(?:^|\\s)(?:${mapped.map((testCase) => escapeRegex(testCase.testTitle)).join('|')})$`;
  return [...files, `--grep=${titlePattern}`];
}

function flattenTests(suites: PlaywrightSuite[]): Array<{ spec: PlaywrightTestSpec; test: PlaywrightTest }> {
  const found: Array<{ spec: PlaywrightTestSpec; test: PlaywrightTest }> = [];

  const walk = (suite: PlaywrightSuite): void => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        found.push({ spec: { ...spec, file: spec.file ?? suite.file }, test });
      }
    }
    for (const nested of suite.suites ?? []) {
      walk({ ...nested, file: nested.file ?? suite.file });
    }
  };

  suites.forEach(walk);
  return found;
}

export function parsePlaywrightReport(
  report: unknown,
  mapped: MappedTestCase[],
  environment: string
): TestExecutionRecord[] {
  if (!report || typeof report !== 'object' || !('suites' in report) || !Array.isArray(report.suites)) {
    throw new Error('[runStory] Playwright JSON report is invalid: expected a suites array.');
  }

  const flattened = flattenTests((report as PlaywrightReport).suites ?? []);
  if (flattened.length === 0) {
    throw new Error('[runStory] Playwright produced a valid report with zero test results.');
  }

  const mappedByTitle = new Map(mapped.map((item) => [item.testTitle, item]));
  const records: TestExecutionRecord[] = [];

  for (const { spec, test } of flattened) {
    const mappedCase = mappedByTitle.get(spec.title);
    if (!mappedCase) continue;

    const idAnnotation = test.annotations?.find((annotation) => annotation.type === 'testCaseId');
    const acAnnotation = test.annotations?.find((annotation) => annotation.type === 'acceptanceCriterionIds');
    if (idAnnotation?.description !== mappedCase.id) {
      throw new Error(`[runStory] Playwright test "${spec.title}" is missing the expected testCaseId annotation.`);
    }
    const expectedCriterionIds = mappedCase.acceptanceCriteria.map((criterion) => criterion.id).sort();
    const annotatedCriterionIds = (acAnnotation?.description ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .sort();
    if (
      expectedCriterionIds.length === 0 ||
      expectedCriterionIds.join(',') !== annotatedCriterionIds.join(',')
    ) {
      throw new Error(
        `[runStory] Playwright test "${spec.title}" must have an acceptanceCriterionIds annotation matching ` +
        `${expectedCriterionIds.join(', ')}.`
      );
    }

    const latestResult = test.results?.[test.results.length - 1];
    const status = latestResult?.status ?? test.status;
    const statusMap: Record<string, TestResult> = {
      passed: 'Pass',
      failed: 'Fail',
      timedOut: 'Fail',
      skipped: 'Skipped',
      interrupted: 'Fail',
    };
    const result = status ? statusMap[status] : undefined;
    if (!result) {
      throw new Error(`[runStory] Playwright result for "${spec.title}" has an unsupported or missing status.`);
    }

    const errors = latestResult?.errors ?? test.errors ?? [];
    const attachments = latestResult?.attachments ?? test.attachments ?? [];
    const screenshot = attachments.find((attachment) =>
      attachment.contentType === 'image/png' && attachment.path
    );
    const video = attachments.find((attachment) =>
      attachment.contentType === 'video/webm' && attachment.path
    );
    const trace = attachments.find((attachment) =>
      attachment.name.toLowerCase().includes('trace') && attachment.path
    );
    const actualUrl = test.annotations?.find((annotation) => annotation.type === 'actualUrl')?.description;
    const expectedUrl = test.annotations?.find((annotation) => annotation.type === 'expectedUrl')?.description;

    records.push({
      testCaseId: mappedCase.id,
      testName: spec.title,
      result,
      duration: latestResult?.duration ?? test.duration ?? 0,
      error: errors[0]
        ? `${errors[0].message ?? ''}\n${errors[0].stack ?? ''}`.trim()
        : undefined,
      screenshotPath: screenshot?.path,
      videoPath: video?.path,
      tracePath: trace?.path,
      browser: test.projectName,
      environment,
      actualUrl,
      expectedUrl,
      runDate: new Date().toISOString(),
      acceptanceCriterionIds: expectedCriterionIds,
      specFile: spec.file ?? mappedCase.specFile,
    });
  }

  const mappedIds = new Set(records.map((record) => record.testCaseId));
  const missing = mapped.filter((testCase) => !mappedIds.has(testCase.id));
  if (missing.length > 0) {
    throw new Error(
      `[runStory] Mapped Playwright tests were not found in the execution report: ${missing.map((item) => item.id).join(', ')}.`
    );
  }

  return records;
}
