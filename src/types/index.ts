// =============================================================================
// sketchplay-qa-agent — Shared Type Definitions
// =============================================================================

// ─── Azure DevOps ─────────────────────────────────────────────────────────────

export interface WorkItemField {
  'System.Title':                string;
  'System.Description':          string;
  'Microsoft.VSTS.Common.AcceptanceCriteria'?: string;
  'System.WorkItemType':         string;
  'System.State':                string;
  'System.AssignedTo'?:          { displayName: string; uniqueName: string };
  'System.AreaPath':             string;
  'System.IterationPath':        string;
  'System.Tags'?:                string;
  [key: string]: unknown;
}

export interface WorkItem {
  id:     number;
  rev:    number;
  fields: WorkItemField;
  url:    string;
  _links: {
    self:         { href: string };
    workItemType: { href: string };
    attachments?: { href: string };
  };
}

export interface UserStoryDetails {
  id:                 number;
  title:              string;
  description:        string;
  acceptanceCriteria: string;
  workItemType:       string;
  state:              string;
  areaPath:           string;
  iterationPath:      string;
  tags:               string[];
  url:                string;
}

export interface AcceptanceCriterion {
  id:   string;
  text: string;
}

export interface PlaywrightMapping {
  specFile:  string;
  testTitle: string;
}

export interface AttachmentUploadResponse {
  id:   string;
  url:  string;
  name?: string;
}

export interface WorkItemUpdateResponse {
  id:     number;
  rev:    number;
  fields: WorkItemField;
}

// ─── Test Case Generation ─────────────────────────────────────────────────────

export type TestCaseType = 'Positive' | 'Negative' | 'Edge Case' | 'Field-Level Validation';
export type AutomationStatus = 'Automated' | 'Manual' | 'Not Automatable' | 'Pending';

export interface TestCase {
  /** Unique identifier e.g. TC-001 */
  id:              string;
  /** Short scenario name; generated IDs are local and are not ADO work item IDs. */
  title:           string;
  description:     string;
  type:            TestCaseType;
  testSteps:       string[];
  expectedResult:  string;
  acceptanceCriteria: AcceptanceCriterion[];
  /** Set only after a human verifies a matching Playwright test exists. */
  automationMapping: PlaywrightMapping | null;
  actualResult:    string;
  automationStatus: AutomationStatus;
  automationRunDate: string;
  /** ID of the parent User Story */
  storyId:         number;
  /** Human-readable story title */
  storyTitle:      string;
}

export interface TestCaseGenerationResult {
  storyId:      number;
  storyTitle:   string;
  testCases:    TestCase[];
  generatedAt:  string;
  generatedBy:  'llm' | 'rule-based';
  excelFilePath?: string;
  attachmentId?:  string;
}

// ─── Excel Report ─────────────────────────────────────────────────────────────

/** Matches the exact column order required by the spec */
export interface ExcelRow {
  testCaseId:        string;
  testCaseTitle:     string;
  acceptanceCriteria: string;
  testCaseDescription: string;
  testSteps:         string;
  expectedResult:    string;
  actualResult:      string;
  qaAutomationStatus: AutomationStatus;
  automationTestRunDate: string;
}

// ─── Test Execution ───────────────────────────────────────────────────────────

export type TestResult = 'Pass' | 'Fail' | 'Skipped' | 'Pending';

export interface TestExecutionRecord {
  testCaseId:       string;
  testName:         string;
  acceptanceCriterionIds?: string[];
  specFile?:        string;
  result:           TestResult;
  duration:         number; // ms
  error?:           string;
  screenshotPath?:  string;
  videoPath?:       string;
  tracePath?:       string;
  browser?:         string;
  environment?:     string;
  actualUrl?:       string;
  expectedUrl?:     string;
  bugWorkItemId?:   number;
  runDate:          string;
}

// ─── Bug Work Item ────────────────────────────────────────────────────────────

export interface BugPayload {
  title:           string;
  description:     string;
  stepsToReproduce: string;
  actualResult:    string;
  expectedResult:  string;
  systemInfo:      string;
  parentStoryId:   number;
  areaPath:        string;
  iterationPath:   string;
}

export interface CreatedBug {
  id:             number;
  title:          string;
  url:            string;
  attachmentUrls: string[];
}

// ─── Self-Healing Locator ─────────────────────────────────────────────────────

export type LocatorStrategy = 'css' | 'xpath' | 'data-testid' | 'role' | 'text' | 'label' | 'placeholder';

export interface LocatorCandidate {
  strategy: LocatorStrategy;
  value:    string;
}

export interface HealedLocatorResult {
  strategy:  LocatorStrategy;
  value:     string;
  attempts:  number;
  healed:    boolean;
}

// ─── Story Runner ─────────────────────────────────────────────────────────────

export interface StoryRunOptions {
  storyId:      number;
  targetUrl?:   string;
  project?:     string;
  grep?:        string;
  headed?:      boolean;
  updateExcel?: boolean;
  updateAdo?:   boolean;
}

export interface StoryRunResult {
  storyId:          number;
  totalTests:       number;
  passed:           number;
  failed:           number;
  skipped:          number;
  duration:         number;
  bugsCreated:      CreatedBug[];
  executions:       TestExecutionRecord[];
  excelFilePath?:   string;
  allureReportPath?: string;
}
