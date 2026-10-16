# sketchplay-qa-agent

Enterprise-grade autonomous Playwright testing agent with Azure DevOps integration, self-healing locators, LLM-powered test case generation, and Allure reporting.

---

## Architecture Overview

```
sketchplay-qa-agent/
├── config/                     # Environment config with typed accessors
│   └── env.ts
├── scripts/                    # Autonomous pipeline entry points
│   ├── analyzeStory.ts         # Script 1: Fetch story → generate tests → export Excel → attach to ADO
│   └── runStory.ts             # Script 2: Run tests → update Excel → log bugs → post ADO summary
├── src/
│   ├── agents/
│   │   ├── bugLogger.ts        # Autonomous bug creation in Azure DevOps on test failure
│   │   └── testCaseGenerator.ts# LLM (GPT-4o) + rule-based test case generation
│   ├── clients/
│   │   └── azureDevOps.client.ts # ADO REST API: work items, attachments, bugs, comments
│   ├── fixtures/
│   │   ├── auth.fixture.ts     # authenticatedPage, mothershipPage fixtures
│   │   └── test.fixture.ts     # Master fixture: page objects + Allure + failure hooks
│   ├── pages/
│   │   ├── BasePage.ts         # Self-healing locator base class
│   │   ├── LoginPage.ts        # Login POM
│   │   └── DashboardPage.ts    # Dashboard POM
│   ├── reporters/
│   │   └── excelReporter.ts    # Styled .xlsx export with AC traceability and execution columns
│   ├── setup/
│   │   ├── global-setup.ts     # Auth setup + dir creation + Allure env
│   │   └── global-teardown.ts  # Allure executor.json
│   ├── types/
│   │   └── index.ts            # All shared TypeScript interfaces
│   └── utils/
│       ├── screenshot.helper.ts
│       └── video.helper.ts
├── tests/
│   ├── auth/
│   │   ├── web.setup.ts        # Web portal auth setup project
│   │   └── mothership.setup.ts # Mothership auth setup project
│   ├── login/
│   │   └── login.spec.ts       # 19 login tests (positive + negative + field-level)
│   └── dashboard/
│       └── dashboard.spec.ts   # 18 dashboard tests
├── test-artifacts/
│   ├── screenshots/            # Full-page screenshots (auto-captured on failure)
│   ├── videos/                 # .webm recordings (auto-captured on failure)
│   └── excel/                  # Generated .xlsx test case files
├── .auth/                      # Playwright storageState files (git-ignored)
├── allure-results/             # Allure raw results
├── allure-report/              # Generated Allure HTML report
├── playwright.config.ts
├── tsconfig.json
└── .env.example
```

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 20.0.0 |
| npm | ≥ 9.0.0 |
| Java (for Allure CLI) | ≥ 11 |
| Allure CLI | `npm i -g allure-commandline` |

---

## Installation

```bash
# 1. Clone the repository
cd d:/Sketrchplay-Security
git clone <repo-url> sketchplay-qa-agent
cd sketchplay-qa-agent

# 2. Install dependencies
npm install

# 3. Install Playwright browsers
npm run install:browsers

# 4. Copy and configure environment
cp .env.example .env
# Edit .env with your credentials and Azure DevOps PAT
```

---

## Environment Configuration

Copy `.env.example` to `.env` and fill in all values.

| Variable | Description | Required |
|---|---|---|
| `WEB_BASE_URL` | Sketchplay web portal URL | ✅ |
| `MOTHERSHIP_BASE_URL` | Mothership portal URL | Optional |
| `WEB_USER_EMAIL` | QA test account email | ✅ |
| `WEB_USER_PASSWORD` | QA test account password | ✅ |
| `MOTHERSHIP_USER_EMAIL` | Mothership QA account email | Optional |
| `MOTHERSHIP_USER_PASSWORD` | Mothership QA account password | Optional |
| `AZURE_DEVOPS_ORG_URL` | ADO org URL e.g. `https://dev.azure.com/myorg` | ✅ for ADO features |
| `AZURE_DEVOPS_PROJECT` | ADO project name | ✅ for ADO features |
| `AZURE_DEVOPS_PAT` | Personal Access Token (Work Items R/W + Attachments) | ✅ for ADO features |
| `AZURE_DEVOPS_AREA_PATH` | Area path for new bug work items | Optional |
| `AZURE_DEVOPS_ITERATION_PATH` | Iteration path for new bug work items | Optional |
| `OPENAI_API_KEY` | OpenAI API key for LLM test generation | Optional |
| `OPENAI_MODEL` | GPT model (default: `gpt-4o`) | Optional |
| `USE_LLM` | Legacy setting; story analysis uses rule-based generation by default. Use `--use-llm` to opt in to AI generation. | Optional |
| `TEST_ENV` | `dev` / `stage` / `production` | Optional |
| `CI` | `true` in CI pipelines | Optional |

---

## Workflow

For the step-by-step two-phase operational runbook, see [RUN-QA-PROJECT.md](./RUN-QA-PROJECT.md).

### Script 1 — Analyze Story & Generate Test Cases

Given an Azure DevOps User Story ID or URL, this script:

1. Fetches the work item (Title, Description, Acceptance Criteria)
2. Requires explicit Acceptance Criteria and generates criterion-mapped cases via LLM (GPT-4o) or rule-based engine
3. Exports a styled `.xlsx` file with all test cases
4. Attaches the Excel file to the Azure DevOps User Story
5. Posts an HTML summary comment to the work item discussion

```bash
# By story ID
npm run analyze:story -- 1234

# By full ADO URL
npm run analyze:story -- https://dev.azure.com/org/proj/_workitems/edit/1234

# Dry run (no ADO writes — generates Excel locally only)
npm run analyze:story -- 1234 --dry-run

# AI generation is optional; the default command uses the rule-based generator
npm run analyze:story -- 1234 --use-llm
```

**Output:** `test-artifacts/excel/TC_Story1234_<title>_<timestamp>.xlsx`

Generated `TC-###` values are local register IDs, not Azure DevOps Test Case work items. Each row and manifest entry includes an explicit AC reference. After changing generator rules, run `analyze:story` to create a fresh workbook. The default command uses the deterministic rule-based generator. Add `--use-llm` only when you want AI generation.

---

### Script 2 — Run Story Tests

Executes only Playwright tests explicitly mapped in that story's latest manifest, then:

1. Runs tests using the Playwright CLI with JSON reporter
2. Parses results (Pass / Fail / Skipped per test case)
3. Updates the Excel file with actual results and timestamps
4. Re-attaches the updated Excel to the Azure DevOps story
5. Posts an HTML execution summary to the work item
6. Existing failure hooks may create bugs; this workflow does not classify failures or deduplicate Bugs.

Newly generated cases have no Playwright mapping by default. Before `run:story`, review and edit the case entries in `test-artifacts/excel/manifest_story<id>.json`, setting `automationMapping` only after verifying an existing Playwright spec path and exact test title, for example:

```json
"automationMapping": {
  "specFile": "tests/login/login.spec.ts",
  "testTitle": "TC-001: Valid credentials allow access to the application"
}
```

The Playwright test must include `testCaseId` and `acceptanceCriterionIds` annotations exactly matching that manifest entry. Run with the Playwright project containing the mapped spec (for example, `login-tests` for `tests/login`). If there are no mappings, the runner stops rather than executing unrelated tests. Generated manifest entries set `adoTestCasesCreated` to `false`: this workflow does not create Azure DevOps Test Case work items.

```bash
# Run mapped tests for story 1234 in Chromium
npm run run:story -- 1234

# Select only mapped tests on another browser
npm run run:story -- 1234 --project=firefox

# Override target URL
npm run run:story -- 1234 --url=https://staging.sketchplay.co.uk

# Dry run (no ADO updates)
npm run run:story -- 1234 --dry-run
```

**Options:**

| Flag | Description |
|---|---|
| `--project=<name>` | Playwright project (default: `chromium`) |
| `--headed` | Run in headed (visible) browser |
| `--no-excel` | Skip Excel update |
| `--no-ado` | Skip Azure DevOps update |
| `--dry-run` | Parse results only, no writes |
| `--url=<url>` | Override `WEB_BASE_URL` for this run |

---

## Running Tests Directly

```bash
# Run all tests
npm test

# Run specific test file
npm run test:login
npm run test:dashboard

# Run in specific browser
npm run test:chromium
npm run test:firefox
npm run test:webkit

# Headed mode for debugging
npm run test:headed

# Debug mode (Playwright Inspector)
npm run test:debug

# Playwright UI mode
npm run test:ui

# CI mode (with Allure reporter)
npm run test:ci
```

---

## Allure Reporting

```bash
# Generate the HTML report from raw results
npm run allure:generate

# Open the generated report in browser
npm run allure:open

# Serve live results during test run
npm run allure:serve

# One command: generate + open
npm run allure:report
```

The Allure report includes:
- Test suite breakdown by Epic / Feature / Story
- Per-test steps with screenshots attached inline
- Failure screenshots and video recordings
- Azure DevOps issue links (Bug / Story)
- Environment properties (browser, OS, URL, CI flag)
- Failure categories (Product Defects, Timeouts, Infrastructure, Auth)

---

## Self-Healing Locator Strategy

The `BasePage.resolveLocator()` method cascades through up to 7 strategies before
surfacing a Playwright error:

| Priority | Strategy | Example |
|---|---|---|
| 1 | `data-testid` | `[data-testid="submit-btn"]` |
| 2 | CSS selector | `button[type="submit"]` |
| 3 | ARIA role + name | `getByRole("button", { name: "Sign in" })` |
| 4 | Label text | `getByLabel("Email")` |
| 5 | Placeholder text | `getByPlaceholder("Enter email")` |
| 6 | Visible text | `getByText("Sign in")` |
| 7 | XPath | `//button[@type="submit"]` |

When a primary locator fails and a fallback succeeds, a warning is logged:
```
[Self-Heal] "submit button" healed after 1 attempt(s). Using strategy "role": "button:Sign in"
```

---

## Page Object Model

All page objects extend `BasePage` and override two properties:

```typescript
export class MyFeaturePage extends BasePage {
  protected readonly path = '/my-feature';
  protected readonly pageLoadedSelector = '[data-testid="my-feature-root"]';
}
```

Use the inherited `find()` helper for concise locator definitions with fallbacks:

```typescript
private get submitButton() {
  return this.find(
    'button[type="submit"]',          // primary CSS
    {
      testId: 'submit-button',        // fallback 1
      role:   'button:Submit',        // fallback 2
      text:   'Submit',               // fallback 3
    }
  );
}
```

---

## Test Fixture Usage

Import from the custom fixture instead of `@playwright/test`:

```typescript
import { test, expect } from '../../src/fixtures/test.fixture';

test.use({
  storyId:    1234,    // links failure bugs to this ADO story
  testCaseId: 'TC-001',
});

test('My test', async ({ loginPage, dashboardPage, qaPage }) => {
  await loginPage.goto();
  await loginPage.login(email, password);
  await dashboardPage.assertAuthenticated();
});
```

**Available fixtures:**

| Fixture | Type | Description |
|---|---|---|
| `loginPage` | `LoginPage` | Pre-instantiated login POM |
| `dashboardPage` | `DashboardPage` | Pre-instantiated dashboard POM |
| `qaPage` | `Page` | Authenticated page (alias) |
| `authenticatedPage` | `Page` | Web portal authenticated page |
| `mothershipPage` | `Page` | Mothership authenticated page |
| `storyId` | `number` | ADO story ID for bug linking |
| `testCaseId` | `string` | Test case ID for Allure/Excel |

On any test failure, the fixture automatically:
- Captures a full-page screenshot
- Captures the `.webm` video recording
- Attaches both to the Allure report
- Creates a linked Bug in Azure DevOps (if `AZURE_DEVOPS_PAT` is set and `storyId > 0`)

---

## Azure DevOps PAT Permissions

Your PAT must have the following scopes:

| Scope | Permission |
|---|---|
| Work Items | Read & Write |
| Attachments | Read & Write |
| Project and Team | Read |

---

## Excel Report Column Schema

The generated `.xlsx` file contains exactly these columns in this order:

| Column | Description |
|---|---|
| Test Case ID | e.g. `TC-001` |
| Test Case Description | `[Positive] Verify valid login` |
| Test Steps | Numbered steps |
| Expected Result | What should happen |
| Actual Result | Populated after execution |
| QA Automation Status | `Pending` / `Automated` / `Pass` / `Fail` |
| Automation Test Run Date | ISO timestamp after execution |

---

## Cleaning Artifacts

```bash
# Clean Allure results, screenshots, videos, PW report
npm run clean

# Remove saved auth state (forces re-login on next run)
npm run clean:auth

# Clean everything
npm run clean:all
```

---

## CI/CD Integration (Azure Pipelines example)

```yaml
trigger:
  branches:
    include: [main, develop]

pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: npm ci
    displayName: Install dependencies

  - script: npm run install:browsers
    displayName: Install Playwright browsers

  - script: npm run analyze:story -- $(STORY_ID)
    displayName: Generate test cases
    env:
      AZURE_DEVOPS_PAT: $(AZURE_DEVOPS_PAT)
      AZURE_DEVOPS_ORG_URL: $(AZURE_DEVOPS_ORG_URL)
      AZURE_DEVOPS_PROJECT: $(AZURE_DEVOPS_PROJECT)
      WEB_BASE_URL: $(WEB_BASE_URL)
      WEB_USER_EMAIL: $(WEB_USER_EMAIL)
      WEB_USER_PASSWORD: $(WEB_USER_PASSWORD)
      OPENAI_API_KEY: $(OPENAI_API_KEY)

  - script: npm run run:story -- $(STORY_ID) --project=chromium
    displayName: Run tests
    env:
      CI: 'true'
      AZURE_DEVOPS_PAT: $(AZURE_DEVOPS_PAT)

  - script: npm run allure:generate
    displayName: Generate Allure report
    condition: always()

  - task: PublishTestResults@2
    inputs:
      testResultsFormat: JUnit
      testResultsFiles: 'playwright-report/*.xml'
    condition: always()

  - task: PublishPipelineArtifact@1
    inputs:
      targetPath: allure-report
      artifact: allure-report
    condition: always()
```

---

## Adding New Page Objects

1. Create `src/pages/MyPage.ts` extending `BasePage`
2. Define locators using `find()` with fallback strategies
3. Implement action methods with `allure.step()` wrapping
4. Add assertions using inherited `assertVisible`, `assertText`, etc.
5. Register the page object in `src/fixtures/test.fixture.ts`

---

## Adding New Test Specs

1. Create `tests/<feature>/<feature>.spec.ts`
2. Import from `../../src/fixtures/test.fixture` (not `@playwright/test`)
3. Set `storyId` and `testCaseId` via `test.use()` or per-test annotations
4. Structure tests into `describe` blocks: Positive / Negative / Field-Level Validation
5. Add Allure labels: `epic`, `feature`, `story`, `severity`

---

## Troubleshooting

**Auth setup fails:**
- Verify `WEB_BASE_URL`, `WEB_USER_EMAIL`, `WEB_USER_PASSWORD` in `.env`
- Run `npm run clean:auth` then retry — stale sessions sometimes cause issues
- Check the login page URL path matches `/login` in `global-setup.ts`

**Azure DevOps 401 errors:**
- Verify `AZURE_DEVOPS_PAT` has Work Items Read+Write and Attachments scopes
- Confirm `AZURE_DEVOPS_ORG_URL` has no trailing slash

**LLM generation not working:**
- Confirm `OPENAI_API_KEY` is set and the key has access to `gpt-4o`
- Story analysis uses rule-based generation by default; add `--use-llm` to opt into AI generation

**Allure report empty:**
- Run `npm run test:ci` first to populate `allure-results/`
- Then `npm run allure:generate && npm run allure:open`

---

## Technology Stack

| Component | Technology |
|---|---|
| Test runner | Playwright 1.48 |
| Language | TypeScript 5.6 |
| Test generation | OpenAI GPT-4o / Rule-based |
| Azure DevOps | REST API v7.1 via axios |
| Excel reports | ExcelJS 4.4 |
| Reporting | Allure 3 (allure-playwright) |
| Date handling | Day.js |
| CLI output | Chalk 4 |

---

*Generated by sketchplay-qa-agent v1.0*
