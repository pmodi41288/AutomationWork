# Run the QA Project

This runbook describes the current two-phase workflow for generating the test register, attaching it to an Azure DevOps User Story, then running mapped Playwright tests against the configured application URL.

> **Important current limitations:** Generated `TC-###` entries are local register IDs, not Azure DevOps Test Case work items. New cases are not automatically mapped to Playwright tests. The current failure handlers can create more than one Bug for the same failed test, do not classify failures before Bug creation, and do not link a Bug to an Azure DevOps Test Case. Review the notes in Phase 2 before running against a live Azure DevOps project.

## Before You Start

1. Open a PowerShell terminal in the project directory:

   ```powershell
   Set-Location 'D:\Sketchplay-Security\sketchplay-qa-agent'
   ```

2. Configure the project's ignored `.env` file. Do not put secrets in this document or commit `.env`.

   Required for Azure DevOps writes:

   ```dotenv
   AZURE_DEVOPS_ORG_URL=your-organization-url
   AZURE_DEVOPS_PROJECT=your-project-name
   AZURE_DEVOPS_PAT=your-personal-access-token
   ```

   Configure the application URL and approved test account:

   ```dotenv
   WEB_BASE_URL=your-application-url
   WEB_USER_EMAIL=your-approved-test-account
   WEB_USER_PASSWORD=your-test-account-password
   TEST_ENV=stage
   ```

   For Bug work item defaults, set `AZURE_DEVOPS_AREA_PATH` and `AZURE_DEVOPS_ITERATION_PATH` if the project requires them. Credentials must be actual approved QA credentials; do not use invented or production-user credentials.

3. Install dependencies and the browser if this is a fresh checkout:

   ```powershell
   npm install
   npx playwright install chromium
   ```

4. Use the numeric Azure DevOps User Story ID in both phases. The ID is passed as a command-line argument; it is not read from `.env`.

## Phase 1 — Generate Cases and Attach to Azure DevOps

Run the generator in live mode, replacing `<storyId>` with the User Story ID:

```powershell
npm run analyze:story -- <storyId>
```

Example:

```powershell
npm run analyze:story -- 27531
```

This phase fetches the User Story from the configured Azure DevOps organization/project, requires explicit Acceptance Criteria, generates criterion-mapped cases, saves an Excel workbook and JSON manifest under `test-artifacts\excel\`, attaches the workbook to the story, and posts a summary comment.

Use `--dry-run` to generate local artifacts without writing to Azure DevOps:

```powershell
npm run analyze:story -- <storyId> --dry-run
```

Review the console output and the generated workbook before proceeding. The manifest is:

```text
test-artifacts\excel\manifest_story<storyId>.json
```

The generator sets each case's `automationMapping` to `null`. Cases without a verified mapping cannot be run by Phase 2. The generated case steps are not generated Playwright code, and `TC-###` is not an Azure DevOps Test Case ID.

## Phase 2 — Run Mapped Cases and Publish Results

### 1. Prepare mappings

Review each case in the manifest and map only cases that have an existing, verified Playwright test with matching behavior. Edit that case's `automationMapping` using a project-relative spec path and the exact test title. For example:

```json
"automationMapping": {
  "specFile": "tests/login/login.spec.ts",
  "testTitle": "TC-001: Valid credentials allow access to the application"
}
```

The mapped Playwright test must have both annotations:

- `testCaseId` with the same local ID, such as `TC-001`
- `acceptanceCriterionIds` with the same AC references as the manifest, such as `AC1`

The shared fixture supports those annotations through the `testCaseId` and `acceptanceCriterionIds` test options, or the test may add equivalent annotations directly to `testInfo`. Do not map a generated scenario to an existing test merely because its title looks similar; verify its steps and expected behavior first.

If no cases have verified mappings, stop here: the runner intentionally fails closed rather than executing unrelated tests. Update the manifest after Phase 1 and before running Phase 2. Re-running Phase 1 will regenerate the manifest and replace manual mappings.

### 2. Execute against the configured URL

The runner uses `WEB_BASE_URL` from `.env`. It runs only the tests in the mappings, parses Playwright's JSON results, updates the workbook, attaches the updated workbook to the User Story, and posts an execution summary. Do not pass `--dry-run` or `--no-ado` if the run must publish results to Azure DevOps.

For specs under `tests/login/`, select the configured `login-tests` project:

```powershell
npm run run:story -- <storyId> --project=login-tests
```

For a mapped spec under another directory, select the Playwright project whose `testMatch` includes that spec, for example:

```powershell
npm run run:story -- <storyId> --project=chromium
```

You may override the configured application URL for one run:

```powershell
npm run run:story -- <storyId> --project=login-tests --url="https://qa.example.test/login"
```

Prefer setting `WEB_BASE_URL` in `.env` when the application URL includes query parameters. Do not include passwords, tokens, or other secrets in a URL or command line.

Other supported options:

| Option | Effect |
| --- | --- |
| `--headed` | Show the browser during execution. |
| `--no-excel` | Do not update the workbook locally. |
| `--no-ado` | Do not upload results or post the run summary. |
| `--dry-run` | Do not write results to Azure DevOps. |

The runner rejects `--grep`; choose tests by editing verified mappings in the manifest.

### 3. Review execution evidence

The runner writes a JSON result manifest and Playwright output under `test-artifacts\excel\` and `test-artifacts\playwright-output\`. Review the Playwright report, screenshots/traces when available, updated Excel, and the User Story history comment. A non-zero command exit may mean tests failed; inspect the result manifest and artifacts rather than assuming the run did not execute.

### Bug creation and linking: current behavior

When a test fails during a live run:

- The test fixture can call `BugLogger` when Azure DevOps is configured and a positive `STORY_ID` is present.
- The runner's Azure DevOps update path also creates a Bug for each failed execution unless `--no-ado` or `--dry-run` was specified.
- Both paths can therefore create duplicate Bugs for one failure. The current workflow does not check for equivalent existing Bugs or classify failures as product defects before creating them.
- The runner-created Bug is linked to the User Story and may have screenshot/video evidence attached. The fixture-created Bug also links to the story and attempts to attach evidence.
- The current automation does not create real ADO Test Case work items and does not add a Bug-to-Test-Case relation. Its `TC-###` references identify local manifest entries only.

Because of the duplicate-Bug risk, do not use live Phase 2 for failure cases when duplicate work items are unacceptable. Run with `--dry-run` to collect local evidence without ADO writes, or first have the Bug creation flow changed to classify failures and deduplicate. Do not disable ADO writes if live Azure DevOps execution results need to be published.

## Complete Example

```powershell
Set-Location 'D:\Sketchplay-Security\sketchplay-qa-agent'

# Phase 1: create the workbook and attach it to the story
npm run analyze:story -- 27531

# Review the workbook and manifest; add only verified automation mappings

# Phase 2: execute mapped tests and publish results
npm run run:story -- 27531 --project=login-tests
```

The example ID is illustrative. Use the intended story ID and its actual Acceptance Criteria. Before any live execution, confirm the configured URL, test account, mapped tests, and the Bug-creation behavior above.
