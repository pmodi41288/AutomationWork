/**
 * Script 1: analyzeStory.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Autonomous pipeline:
 *   1. Fetch User Story details from Azure DevOps (by ID or URL)
 *   2. Generate exhaustive test cases (LLM or rule-based)
 *   3. Export test cases to a styled .xlsx file
 *   4. Attach the Excel file to the Azure DevOps User Story
 *   5. Post a discussion comment to the Work Item history
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/analyzeStory.ts <storyId|url> [--dry-run]
 *
 * Examples:
 *   npx ts-node scripts/analyzeStory.ts 1234
 *   npx ts-node scripts/analyzeStory.ts https://dev.azure.com/org/proj/_workitems/edit/1234
 *   npx ts-node scripts/analyzeStory.ts 1234 --dry-run
 */

import * as path from 'path';

// Bootstrap env before any config imports
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import chalk from 'chalk';
import dayjs from 'dayjs';
import { AzureDevOpsClient }   from '../src/clients/azureDevOps.client';
import { TestCaseGenerator }   from '../src/agents/testCaseGenerator';
import { ExcelReporter }       from '../src/reporters/excelReporter';
import { UserStoryDetails, TestCaseGenerationResult } from '../src/types/index';

// ─── CLI Argument Parsing ─────────────────────────────────────────────────────

function parseArgs(): { storyInput: string; dryRun: boolean; useLLM: boolean } {
  const args     = process.argv.slice(2);
  const storyInput = args.find((a) => !a.startsWith('--'));
  const dryRun   = args.includes('--dry-run');
  const useLLM = args.includes('--use-llm') && !args.includes('--rules-only');

  if (!storyInput) {
    console.error(
      chalk.red('\n[analyzeStory] Error: No story ID or URL provided.\n') +
      chalk.yellow('Usage: npx ts-node scripts/analyzeStory.ts <storyId|url> [--dry-run] [--use-llm]\n')
    );
    process.exit(1);
  }

  return { storyInput, dryRun, useLLM };
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function printBanner(storyInput: string, dryRun: boolean, useLLM: boolean): void {
  console.log(chalk.blueBright('\n╔══════════════════════════════════════════════════════════╗'));
  console.log(chalk.blueBright('║         sketchplay-qa-agent — Story Analyzer             ║'));
  console.log(chalk.blueBright('╚══════════════════════════════════════════════════════════╝'));
  console.log(chalk.cyan(`  Story:    ${storyInput}`));
  console.log(chalk.cyan(`  Started:  ${dayjs().format('YYYY-MM-DD HH:mm:ss')}`));
  console.log(chalk.cyan(`  Generator: ${useLLM ? 'AI (explicitly enabled)' : 'Rule-based'}`));
  if (dryRun) {
    console.log(chalk.yellow('  Mode:     DRY RUN (Azure DevOps upload will be skipped)\n'));
  } else {
    console.log(chalk.green('  Mode:     LIVE\n'));
  }
}

// ─── Step Logging ─────────────────────────────────────────────────────────────

let stepIndex = 0;

function step(label: string): void {
  stepIndex++;
  console.log(chalk.bold.white(`\nStep ${stepIndex}: ${label}`));
  console.log(chalk.grey('─'.repeat(60)));
}

function success(message: string): void {
  console.log(chalk.green(`  ✔ ${message}`));
}

function warn(message: string): void {
  console.log(chalk.yellow(`  ⚠ ${message}`));
}

// ─── Step 1: Fetch Story ──────────────────────────────────────────────────────

async function fetchStory(
  client: AzureDevOpsClient,
  storyInput: string
): Promise<UserStoryDetails> {
  step('Fetching User Story from Azure DevOps');

  const story = await client.getUserStoryDetails(storyInput);

  success(`Fetched Work Item #${story.id}`);
  console.log(chalk.grey(`  Title:    ${story.title}`));
  console.log(chalk.grey(`  Type:     ${story.workItemType}`));
  console.log(chalk.grey(`  State:    ${story.state}`));
  console.log(chalk.grey(`  Area:     ${story.areaPath}`));
  console.log(
    chalk.grey(`  AC:       ${story.acceptanceCriteria.slice(0, 120)}${story.acceptanceCriteria.length > 120 ? '…' : ''}`)
  );

  return story;
}

// ─── Step 2: Generate Test Cases ──────────────────────────────────────────────

async function generateTestCases(
  generator: TestCaseGenerator,
  story: UserStoryDetails
): Promise<TestCaseGenerationResult> {
  step('Generating test cases');

  const result = await generator.generate(story);

  const byType = {
    positive:   result.testCases.filter((t) => t.type === 'Positive').length,
    negative:   result.testCases.filter((t) => t.type === 'Negative').length,
    edgeCases:  result.testCases.filter((t) => t.type === 'Edge Case').length,
    fieldLevel: result.testCases.filter((t) => t.type === 'Field-Level Validation').length,
  };

  success(`Generated ${result.testCases.length} local test cases via ${result.generatedBy}`);
  console.log(chalk.yellow('  These are local test-register IDs, not Azure DevOps Test Case work items.'));
  console.log(chalk.grey(`  Functional:           ${byType.positive}`));
  console.log(chalk.grey(`  Negative:             ${byType.negative}`));
  console.log(chalk.grey(`  Edge Cases:           ${byType.edgeCases}`));
  console.log(chalk.grey(`  Field-Level Validation: ${byType.fieldLevel}`));

  return result;
}

// ─── Step 3: Export to Excel ──────────────────────────────────────────────────

async function exportToExcel(
  reporter: ExcelReporter,
  result: TestCaseGenerationResult
): Promise<string> {
  step('Exporting test cases to Excel (.xlsx)');

  const filePath = await reporter.generate(result);

  success(`Excel saved: ${path.basename(filePath)}`);
  console.log(chalk.grey(`  Path: ${filePath}`));

  return filePath;
}

// ─── Step 4: Attach Excel to Azure DevOps ────────────────────────────────────

async function attachToAzureDevOps(
  client: AzureDevOpsClient,
  storyId: number,
  storyTitle: string,
  filePath: string,
  testCaseCount: number,
  generatedBy: string,
  dryRun: boolean
): Promise<string | null> {
  step('Attaching Excel file to Azure DevOps User Story');

  if (dryRun) {
    warn('DRY RUN — skipping Azure DevOps attachment upload.');
    return null;
  }

  try {
    const attachment = await client.uploadAndAttach(
      storyId,
      filePath,
      `Auto-generated test cases attached by sketchplay-qa-agent`
    );

    success(`Attachment uploaded: ${attachment.url}`);
    return attachment.url;
  } catch (err) {
    warn(`Failed to upload attachment: ${(err as Error).message}`);
    console.log(chalk.grey('  The Excel file was saved locally and can be attached manually.'));
    return null;
  }
}

// ─── Step 5: Post History Comment ─────────────────────────────────────────────

async function postHistoryComment(
  client: AzureDevOpsClient,
  story: UserStoryDetails,
  result: TestCaseGenerationResult,
  excelFilePath: string,
  attachmentUrl: string | null,
  dryRun: boolean
): Promise<void> {
  step('Posting discussion comment to Work Item history');

  if (dryRun) {
    warn('DRY RUN — skipping Azure DevOps history comment.');
    return;
  }

  const byType = {
    positive:   result.testCases.filter((t) => t.type === 'Positive').length,
    negative:   result.testCases.filter((t) => t.type === 'Negative').length,
    edgeCases:  result.testCases.filter((t) => t.type === 'Edge Case').length,
    fieldLevel: result.testCases.filter((t) => t.type === 'Field-Level Validation').length,
  };

  const commentHtml = `
<h3>🤖 sketchplay-qa-agent — Test Cases Generated</h3>
<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;">
  <thead>
    <tr style="background:#1E3A5F;color:#fff;">
      <th>Metric</th><th>Value</th>
    </tr>
  </thead>
  <tbody>
    <tr><td><b>Generated At</b></td><td>${result.generatedAt}</td></tr>
    <tr><td><b>Generated By</b></td><td>${result.generatedBy}</td></tr>
    <tr><td><b>Total Test Cases</b></td><td>${result.testCases.length}</td></tr>
    <tr><td><b>Functional Cases</b></td><td>${byType.positive}</td></tr>
    <tr><td><b>Negative Cases</b></td><td>${byType.negative}</td></tr>
    <tr><td><b>Edge Cases</b></td><td>${byType.edgeCases}</td></tr>
    <tr><td><b>Field-Level Validations</b></td><td>${byType.fieldLevel}</td></tr>
    <tr><td><b>Excel File</b></td><td>${path.basename(excelFilePath)}</td></tr>
    ${attachmentUrl ? `<tr><td><b>Attachment URL</b></td><td><a href="${attachmentUrl}">View Attachment</a></td></tr>` : ''}
  </tbody>
</table>
<p>The generated test register has been attached to this work item. These rows are not Azure DevOps Test Case work items. Each row includes its mapped Acceptance Criterion.</p>
<p><small>Generated by <strong>sketchplay-qa-agent v1.0</strong> at ${result.generatedAt}</small></p>
  `.trim();

  try {
    await client.addComment(story.id, commentHtml);
    success('History comment posted to Work Item.');
  } catch (err) {
    warn(`Failed to post history comment: ${(err as Error).message}`);
  }
}

// ─── Final Summary ────────────────────────────────────────────────────────────

function printSummary(
  story: UserStoryDetails,
  result: TestCaseGenerationResult,
  excelFilePath: string,
  attachmentUrl: string | null,
  startTime: number
): void {
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(chalk.blueBright('\n╔══════════════════════════════════════════════════════════╗'));
  console.log(chalk.blueBright('║                    Pipeline Complete                     ║'));
  console.log(chalk.blueBright('╚══════════════════════════════════════════════════════════╝'));
  console.log(chalk.green(`  ✔ Story:          #${story.id} — ${story.title}`));
  console.log(chalk.green(`  ✔ Test Cases:     ${result.testCases.length} generated (${result.generatedBy})`));
  console.log(chalk.green(`  ✔ Excel:          ${path.basename(excelFilePath)}`));
  if (attachmentUrl) {
    console.log(chalk.green(`  ✔ ADO Attachment: ${attachmentUrl}`));
  } else {
    console.log(chalk.yellow(`  ⚠ ADO Attachment: Not uploaded (dry-run or error)`));
  }
  console.log(chalk.cyan(`  ⏱ Duration:       ${duration}s\n`));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startTime              = Date.now();
  const { storyInput, dryRun, useLLM } = parseArgs();

  printBanner(storyInput, dryRun, useLLM);

  const adoClient      = new AzureDevOpsClient();
  const generator      = new TestCaseGenerator(useLLM);
  const reporter       = new ExcelReporter();

  // Validate Azure DevOps connectivity before doing work
  if (!dryRun) {
    step('Verifying Azure DevOps connectivity');
    const isAlive = await adoClient.ping();
    if (isAlive) {
      success('Azure DevOps connection verified.');
    } else {
      warn(
        'Azure DevOps ping failed. Check AZURE_DEVOPS_ORG_URL and AZURE_DEVOPS_PAT. ' +
        'Continuing in degraded mode (Excel will still be generated).'
      );
    }
  }

  // Pipeline
  const story         = await fetchStory(adoClient, storyInput);
  const result        = await generateTestCases(generator, story);
  const excelFilePath = await exportToExcel(reporter, result);
  const attachmentUrl = await attachToAzureDevOps(
    adoClient, story.id, story.title,
    excelFilePath, result.testCases.length, result.generatedBy, dryRun
  );
  await postHistoryComment(
    adoClient, story, result, excelFilePath, attachmentUrl, dryRun
  );

  printSummary(story, result, excelFilePath, attachmentUrl, startTime);

  // Write a manifest JSON for downstream scripts (runStory) to consume
  const manifestPath = path.join(
    path.dirname(excelFilePath),
    `manifest_story${story.id}.json`
  );
  const manifest = {
    storyId:       story.id,
    storyTitle:    story.title,
    storyUrl:      story.url,
    generatedAt:   result.generatedAt,
    generatedBy:   result.generatedBy,
    artifactType:  'local-test-register',
    adoTestCasesCreated: false,
    testCaseCount: result.testCases.length,
    excelFilePath,
    attachmentUrl,
    testCases:     result.testCases.map((tc) => ({
      id:          tc.id,
      title:       tc.title,
      type:        tc.type,
      description: tc.description,
      testSteps:   tc.testSteps,
      expectedResult: tc.expectedResult,
      acceptanceCriteria: tc.acceptanceCriteria,
      automationStatus: tc.automationStatus,
      automationMapping: tc.automationMapping,
    })),
  };

  const fs = await import('fs');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(chalk.grey(`  Manifest: ${manifestPath}\n`));
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error(chalk.red(`\n[analyzeStory] Fatal error: ${(err as Error).message}`));
  console.error(chalk.grey((err as Error).stack ?? ''));
  process.exit(1);
});
