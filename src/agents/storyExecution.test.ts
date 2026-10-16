import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPlaywrightSelectionArgs,
  mappedTestCases,
  parsePlaywrightReport,
  StoryManifest,
} from './storyExecution';

const manifest: StoryManifest = {
  storyId: 27531,
  storyTitle: 'Fixture story',
  testCases: [
    {
      id: 'TC-001',
      title: 'Valid login',
      type: 'Positive',
      description: 'Login works',
      expectedResult: 'Dashboard is shown',
      acceptanceCriteria: [{ id: 'AC1', text: 'Successful login reaches dashboard.' }],
      automationMapping: {
        specFile: 'tests/login/login.spec.ts',
        testTitle: 'TC-001: Valid credentials allow access to the application',
      },
    },
    {
      id: 'TC-002',
      title: 'Unmapped case',
      type: 'Negative',
      description: 'Unmapped',
      expectedResult: 'N/A',
      acceptanceCriteria: [{ id: 'AC2', text: 'Invalid login stays on login page.' }],
      automationMapping: null,
    },
  ],
};

describe('story execution mapping', () => {
  it('selects only verified mappings and exact test titles', () => {
    const mapped = mappedTestCases(manifest);
    const args = buildPlaywrightSelectionArgs(mapped);

    assert.deepEqual(args.slice(0, 1), ['tests/login/login.spec.ts']);
    assert.ok(args[1].startsWith('--grep=(?:^|'));
    assert.ok(args[1].includes('\\s'));
    assert.match(args[1], /access to the application/);
    assert.equal(mapped.length, 1);
  });

  it('rejects mapped spec paths outside tests', () => {
    const invalid: StoryManifest = {
      ...manifest,
      testCases: [{
        ...manifest.testCases[0],
        automationMapping: { specFile: '../other.spec.ts', testTitle: 'Test' },
      }],
    };

    assert.throws(() => mappedTestCases(invalid), /relative tests\/\*\*/);
  });

  it('parses mapped results and retains AC mapping plus available artifacts', () => {
    const mapped = mappedTestCases(manifest);
    const records = parsePlaywrightReport({
      suites: [{
        title: 'login.spec.ts',
        file: 'tests/login/login.spec.ts',
        specs: [{
          title: mapped[0].testTitle,
          tests: [{
            projectName: 'chromium',
            annotations: [
              { type: 'testCaseId', description: 'TC-001' },
              { type: 'acceptanceCriterionIds', description: 'AC1' },
            ],
            results: [{
              status: 'failed',
              duration: 142,
              errors: [{ message: 'Expected dashboard URL', stack: 'assertion stack' }],
              attachments: [
                { name: 'screenshot', path: 'failure.png', contentType: 'image/png' },
                { name: 'trace', path: 'trace.zip', contentType: 'application/zip' },
              ],
            }],
          }],
        }],
      }],
    }, mapped, 'qa');

    assert.equal(records.length, 1);
    assert.equal(records[0].result, 'Fail');
    assert.equal(records[0].duration, 142);
    assert.equal(records[0].browser, 'chromium');
    assert.equal(records[0].environment, 'qa');
    assert.equal(records[0].screenshotPath, 'failure.png');
    assert.equal(records[0].tracePath, 'trace.zip');
    assert.deepEqual(records[0].acceptanceCriterionIds, ['AC1']);
  });

  it('fails on malformed, empty, or unmapped Playwright reports', () => {
    const mapped = mappedTestCases(manifest);
    assert.throws(() => parsePlaywrightReport({}, mapped, 'qa'), /suites array/);
    assert.throws(() => parsePlaywrightReport({ suites: [] }, mapped, 'qa'), /zero test results/);
    assert.throws(() => buildPlaywrightSelectionArgs([]), /No generated cases have an explicit Playwright mapping/);
  });

  it('rejects test results without exact case and acceptance-criterion annotations', () => {
    const mapped = mappedTestCases(manifest);
    assert.throws(() => parsePlaywrightReport({
      suites: [{
        title: 'login.spec.ts',
        file: 'tests/login/login.spec.ts',
        specs: [{
          title: mapped[0].testTitle,
          tests: [{
            annotations: [{ type: 'testCaseId', description: 'TC-001' }],
            results: [{ status: 'passed' }],
          }],
        }],
      }],
    }, mapped, 'qa'), /acceptanceCriterionIds annotation/);
  });
});
