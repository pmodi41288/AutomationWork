# Sketchplay QA Agent Pipeline Commands

This document provides the commands to execute the QA testing pipeline for Azure DevOps user stories.

## Prerequisites

Ensure your `.env` file is configured with:
- `AZURE_DEVOPS_ORG_URL` - Your Azure DevOps organization URL
- `AZURE_DEVOPS_PAT` - Personal Access Token with Work Item read/write permissions
- `OPENAI_API_KEY` - For AI-powered test case generation (optional, falls back to rule-based)

---

## Command 1: Generate Test Cases & Attach to Azure DevOps

Creates test cases from a user story and attaches the Excel spreadsheet to the work item.

```powershell
npm run analyze:story -- <storyId>
```

### Examples

```powershell
# Standard execution
npm run analyze:story -- 27582

# AI generation is optional; the default command uses the rule-based generator
npm run analyze:story -- 27582 --use-llm

# Dry run (skip Azure DevOps uploads)
npm run analyze:story -- 27582 --dry-run
```

### What This Does

1. Fetches the user story from Azure DevOps
2. Requires explicit Acceptance Criteria and generates cases mapped to each criterion (AI or rule-based fallback)
3. Exports test cases to Excel (.xlsx)
4. Attaches the Excel file to the Azure DevOps work item
5. Posts a summary comment to the work item history

### Output

- Excel file: `test-artifacts/excel/TC_Story<id>_<title>_<timestamp>.xlsx`
- Manifest: `test-artifacts/excel/manifest_story<id>.json`

The default generator treats the story and its acceptance criteria as the source of truth. It avoids adding unrelated fields, limits, roles, or workflows. If the story does not describe a field or rule, the generator should not invent field-validation expectations for it. Review the generated cases against the story before attaching them.

Generated `TC-###` identifiers are local register IDs, not Azure DevOps Test Case work items. The run manifest records `adoTestCasesCreated: false`; this workflow does not create or verify ADO Test Case work items.

`analyze:story` is the command that regenerates test cases and creates a new, uniquely named Excel file. It uses the rule-based generator by default. Add `--use-llm` only when you want AI-generated cases. `run:story` does not regenerate cases; it reuses the latest generated Excel, updates execution results, and attaches that updated workbook. After changing generator rules, run `analyze:story` first.

---

## Command 2: Execute Tests & Create Bugs for Failures

Runs explicitly mapped Playwright tests and updates Azure DevOps with results. Existing failure hooks may create bugs; failure classification and deduplication are not included in this workflow.

```powershell
npm run run:story -- <storyId> [options]
```

### Examples

```powershell
# Standard execution (chromium default)
npm run run:story -- 27582

# Run on specific browser
npm run run:story -- 27582 --project=chromium
npm run run:story -- 27582 --project=firefox
npm run run:story -- 27582 --project=webkit

# Run in headed mode (visible browser)
npm run run:story -- 27582 --headed

# Skip Excel update
npm run run:story -- 27582 --no-excel

# Skip Azure DevOps updates
npm run run:story -- 27582 --no-ado

# Dry run (parse results only, no writes)
npm run run:story -- 27582 --dry-run

# Override target URL
npm run run:story -- 27582 --url=https://staging.sketchplay.com
```

### What This Does

1. Loads the manifest from `analyze:story`
2. Runs only tests with a verified `automationMapping` in that manifest
3. Parses test results (Pass/Fail/Skipped)
4. Updates the Excel file with execution statuses
5. Uploads the updated Excel back to Azure DevOps
6. Posts an execution summary comment
7. Existing failure hooks may create bugs; failure classification and bug deduplication are not part of this workflow.

Generated cases start with `"automationMapping": null`. Before execution, update a mapped case with the verified spec path and exact Playwright test title, and add matching `testCaseId` and `acceptanceCriterionIds` annotations to the test:

```json
"automationMapping": {
  "specFile": "tests/login/login.spec.ts",
  "testTitle": "TC-001: Valid credentials allow access to the application"
}
```

Use the Playwright project containing the mapped test (for login specs, `--project=login-tests`). If no cases are explicitly mapped, the runner fails closed rather than running unrelated tests. `--grep` is not accepted; edit the manifest mappings to select tests.

### Output

- Playwright report: `test-artifacts/playwright-output/`
- Updated Excel with Pass/Fail statuses
- Run manifest: `test-artifacts/excel/run-result-story<id>.json`

---

## Complete Workflow

```powershell
# Step 1: Generate test cases and attach to story
npm run analyze:story -- 27582

# Step 2: Execute tests and create bugs for failures
npm run run:story -- 27582
```

---

## Troubleshooting

### Azure DevOps Authentication Errors (401)

Check your `.env` configuration:
```env
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/your-org
AZURE_DEVOPS_PAT=your-personal-access-token
```

### OpenAI API Key Errors (401)

The pipeline will fall back to rule-based test case generation if the OpenAI key is invalid. To use AI generation:
```env
OPENAI_API_KEY=sk-your-api-key
```

### Test Execution Errors

- Ensure browsers are installed: `npm run install:browsers`
- Check the target URL is accessible
- Review Playwright output in `test-artifacts/playwright-output/`

---

## File Locations

| File Type | Location |
|-----------|----------|
| Generated Test Cases Excel | `test-artifacts/excel/TC_Story*.xlsx` |
| Manifest (input for runStory) | `test-artifacts/excel/manifest_story*.json` |
| Playwright Output | `test-artifacts/playwright-output/` |
| Screenshots/Videos | `test-artifacts/` |
| Run Results | `test-artifacts/excel/run-result-story*.json` |