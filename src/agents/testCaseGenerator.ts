import OpenAI from 'openai';
import dayjs from 'dayjs';
import {
  UserStoryDetails,
  TestCase,
  TestCaseType,
  TestCaseGenerationResult,
  AutomationStatus,
  AcceptanceCriterion,
} from '../types/index';
import {
  OPENAI_API_KEY,
  OPENAI_MODEL,
  OPENAI_MAX_TOKENS,
} from '../../config/env';

// ─── Constants ────────────────────────────────────────────────────────────────

const TC_ID_PREFIX = 'TC';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function padId(n: number): string {
  return `${TC_ID_PREFIX}-${String(n).padStart(3, '0')}`;
}

function timestamp(): string {
  return dayjs().format('YYYY-MM-DD HH:mm:ss');
}

/**
 * Normalise a raw string into a bullet-style array of steps.
 * Handles newline-delimited lists, HTML <li> tags, and numbered lists.
 */
function toStepArray(raw: string): string[] {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:li|p|div|h[1-6])\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .split(/\n|;/)
    .map((s) => s.replace(/^\s*[\d\-\*•\.]+\s*/, '').trim())
    .filter(Boolean);
}

const VALID_CASE_TYPES: TestCaseType[] = [
  'Positive',
  'Negative',
  'Edge Case',
  'Field-Level Validation',
];

function normalizeAcceptanceCriteria(raw: string): string[] {
  const normalized = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:li|p|div|h[1-6])\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");

  return normalized
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]\s*|\d+[.)]\s*)/, '').trim())
    .map((line) => line.replace(/^(?:AC|Acceptance Criterion)\s*\d+\s*[:.)-]\s*/i, '').trim())
    .filter((line) => line.length > 0 && !/^acceptance criteria\s*:?\s*$/i.test(line));
}

export function parseAcceptanceCriteria(story: UserStoryDetails): AcceptanceCriterion[] {
  const source = story.acceptanceCriteria.trim();
  if (!source) {
    throw new Error(
      `[TestCaseGenerator] Story #${story.id} has no Acceptance Criteria. ` +
      'Generation requires explicit Acceptance Criteria; the description will not be used as a substitute.'
    );
  }

  const lines = normalizeAcceptanceCriteria(source);
  const groups: string[][] = [];
  let gherkinGroup: string[] = [];

  const flushGherkinGroup = (): void => {
    if (gherkinGroup.length > 0) {
      groups.push(gherkinGroup);
      gherkinGroup = [];
    }
  };

  for (const line of lines) {
    if (/^scenario(?: outline)?\s*:/i.test(line)) {
      flushGherkinGroup();
      gherkinGroup.push(line);
    } else if (/^(?:given|when|then|and|but)\b/i.test(line)) {
      gherkinGroup.push(line);
    } else {
      flushGherkinGroup();
      groups.push([line]);
    }
  }
  flushGherkinGroup();

  if (groups.length === 0) {
    throw new Error(`[TestCaseGenerator] Story #${story.id} has no parseable Acceptance Criteria.`);
  }

  return groups.map((group, index) => ({
    id: `AC${index + 1}`,
    text: group.join(' '),
  }));
}

function acceptanceCriterionType(criterion: string): TestCaseType {
  return /\b(do not|does not|did not|must not|should not|shall not|will not|cannot|can't|never|not allowed|not permitted|reject(?:ed)?|invalid|unauthori[sz]ed|denied|prevent(?:ed)?|duplicate|error)\b/i
    .test(criterion)
    ? 'Negative'
    : 'Positive';
}

function validateRawCases(
  cases: RawLLMTestCase[],
  criteria: AcceptanceCriterion[]
): RawLLMTestCase[] {
  if (cases.length === 0) {
    throw new Error('[TestCaseGenerator] No test cases were generated.');
  }

  const criterionIds = new Set(criteria.map((criterion) => criterion.id));

  return cases.map((testCase, index) => {
    if (
      !testCase ||
      !VALID_CASE_TYPES.includes(testCase.type) ||
      typeof testCase.title !== 'string' ||
      !testCase.title.trim() ||
      typeof testCase.description !== 'string' ||
      !testCase.description.trim() ||
      !Array.isArray(testCase.testSteps) ||
      testCase.testSteps.length === 0 ||
      testCase.testSteps.some((step) => typeof step !== 'string' || !step.trim()) ||
      typeof testCase.expectedResult !== 'string' ||
      !testCase.expectedResult.trim() ||
      !Array.isArray(testCase.acceptanceCriterionIds) ||
      testCase.acceptanceCriterionIds.length === 0 ||
      testCase.acceptanceCriterionIds.some(
        (id) => typeof id !== 'string' || !criterionIds.has(id)
      )
    ) {
      throw new Error(`[TestCaseGenerator] Test case ${index + 1} has missing or invalid fields.`);
    }

    return {
      ...testCase,
      title: testCase.title.trim(),
      description: testCase.description.trim(),
      testSteps: testCase.testSteps.map((step) => step.trim()),
      expectedResult: testCase.expectedResult.trim(),
      automationStatus: 'Pending',
    };
  });
}

function validateAcceptanceCoverage(
  cases: RawLLMTestCase[],
  criteria: AcceptanceCriterion[]
): void {
  const covered = new Set(cases.flatMap((testCase) => testCase.acceptanceCriterionIds));
  const missing = criteria.filter((criterion) => !covered.has(criterion.id));
  if (missing.length > 0) {
    throw new Error(
      `[TestCaseGenerator] Generated cases do not explicitly cover: ` +
      `${missing.map((criterion) => criterion.id).join(', ')}.`
    );
  }
}
function buildSystemPrompt(): string {
  return `You are a Senior QA Engineer responsible for creating complete, high-value, automation-ready test cases from a user story.

Your output MUST be a valid JSON array of test case objects with NO surrounding text, markdown, or code fences.

Each test case object must have exactly these fields:
{
  "type":             "Positive" | "Negative" | "Edge Case" | "Field-Level Validation",
  "title":            string,
  "description":      string,
  "testSteps":        string[],
  "expectedResult":   string,
  "acceptanceCriterionIds": string[],
  "automationStatus": "Pending"
}

Your goal is to create test cases that are:
- directly traceable to the story and acceptance criteria
- specific enough for execution
- suitable for Playwright automation where applicable
- free from invented requirements
- focused on business risk and realistic user behavior

Rules:

1. Acceptance Criteria are the primary source of truth.
   - Each supplied criterion has an ID (AC1, AC2, ...); each test case MUST include one or more exact IDs in acceptanceCriterionIds.
   - Every criterion ID must be covered by at least one test case.
   - Do not create a case unless its actions and expected result are supported by its mapped criterion(s).
   - If one acceptance criterion contains multiple independent behaviors, create separate test cases when that improves clarity.
   - Do not create tests for behavior that is not stated or clearly implied.

2. Create strong functional coverage.
   Include:
   - happy path
   - alternative valid path
   - relevant state changes
   - persistence after save/update
   - correct display of updated data
   - navigation outcome when relevant
   - correct relationship between related records when relevant

3. Add Negative tests only when justified.
   Consider:
   - invalid input
   - missing required data
   - unsupported action
   - invalid state transition
   - access not allowed
   - operation on unavailable/deleted/inactive data
   - backend/API failure if failure handling is mentioned or clearly part of the workflow

   Do NOT invent validation messages or restrictions that are not defined.

4. Add Edge Case tests only when relevant.
   Consider:
   - no data
   - single record
   - multiple records
   - repeated action
   - duplicate submission
   - refresh/reload
   - switching tabs or views during loading
   - delayed API response
   - stale data
   - large result set
   - first/last item
   - boundary state
   - previously completed action
   - retry after failure

5. Add Field-Level Validation tests only for fields that exist in the story.
   Test:
   - required behavior
   - valid input
   - invalid input
   - minimum/maximum length only if stated
   - allowed format only if stated or clearly evident
   - trimming/leading-trailing spaces only when relevant
   - duplicate values only when uniqueness is required or implied

   Do not invent field limits, regex rules, or formats.

6. Think like a Senior QA and cover business-impact areas when relevant:
   - role/permission behavior
   - record ownership
   - status changes
   - data persistence
   - related record updates
   - calculation accuracy
   - duplicate prevention
   - consistency across screens
   - error recovery
   - audit/history behavior
   - concurrent or repeated user actions
   - async/race-condition behavior
   - correct behavior after refresh/reopen

   Only include these when they are relevant to the story.

7. For workflows with statuses or lifecycle changes:
   - test allowed transitions
   - test blocked transitions when defined
   - verify UI and backend state remain consistent
   - verify the new state remains correct after refresh

8. For list, table, search, filter, sort, or pagination functionality:
   test only the capabilities mentioned in the story.
   When applicable verify:
   - correct result set
   - empty result
   - clear/reset behavior
   - state after navigation or refresh
   - filter combinations
   - pagination count consistency
   - sorting does not alter unrelated data

9. For AI-generated or generated-content features:
   when applicable verify:
   - generated output is based on selected source content
   - unrelated source content is not introduced
   - repeated generation remains logically consistent
   - generated content can be reviewed before final use if required
   - edits are retained
   - retry behavior works after failure
   - source/reference mapping is accurate if required

10. For asynchronous behavior:
    when relevant verify:
    - loader is shown appropriately
    - stale API responses do not overwrite current selection
    - switching tabs/views during loading does not display incorrect data
    - repeated clicks do not create duplicate actions
    - failure leaves the UI in a recoverable state

11. For permissions:
    only create permission tests when roles or access rules are stated or clearly implied.
    Do not invent role names.

12. Do not add generic login/logout/security tests unless the story specifically involves authentication, authorization, session behavior, or security.

13. Do not invent:
    - page names
    - field names
    - button names
    - roles
    - statuses
    - limits
    - messages
    - API behavior
    - business rules
    - expected calculations
    unless they are present in or clearly implied by the user story.

14. Write test cases in simple, precise English.
    - one action per step
    - avoid vague steps such as "verify functionality"
    - use actual labels from the story when available
    - expected result must be measurable and specific

15. Keep test cases independent where possible.
    Do not make one case depend on another unless the workflow itself requires prior setup.

16. Avoid duplicate test cases.
    If two scenarios validate the same behavior with no meaningful risk difference, keep only one.

17. Prioritize test cases that provide business value.
    Do not inflate the number of cases.

18. Automation readiness:
    Steps should be written so they can later be mapped to Playwright actions.
    Prefer observable UI outcomes and stable business conditions.
    Avoid implementation-specific selectors, CSS, XPath, database checks, or API calls unless the story explicitly requires them.

19. If the story is ambiguous:
    - do not invent the missing rule
    - create the test only for the behavior that is known
    - phrase the expected result around the stated requirement
    - do not add assumptions as facts

20. Do not generate generic tests from keywords alone. Do not add scenarios for search, validation, security, boundaries, or session behavior unless a supplied criterion supports that behavior.

21. Return all applicable test cases and nothing else.
    Output the raw JSON array only.`;
}

function buildUserPrompt(
  story: UserStoryDetails,
  criteria: AcceptanceCriterion[]
): string {
  const criteriaText = criteria.map((criterion) =>
    `${criterion.id}: ${criterion.text}`
  ).join('\n');

  return `Create Senior-QA-level test cases for the following user story.

Use the acceptance criteria as the source of truth.
Do not invent missing business rules.

STORY ID: ${story.id}

TITLE:
${story.title}

DESCRIPTION:
${story.description || '(no description provided)'}

ACCEPTANCE CRITERIA:
${criteriaText}

TAGS:
${story.tags.join(', ') || 'none'}

Generate:
- functional positive cases
- relevant negative cases
- relevant edge cases
- field-level validation only for fields explicitly present
- state-transition coverage when applicable
- permission coverage when applicable
- async/race-condition coverage when applicable
- persistence/refresh coverage when applicable
- data consistency coverage across related UI states when applicable

Make each test case specific, executable, non-duplicate, and suitable for later Playwright automation.

Return only the raw JSON array.`;
}
// ─── LLM Generation ──────────────────────────────────────────────────────────

interface RawLLMTestCase {
  type:             TestCaseType;
  title:            string;
  description:      string;
  testSteps:        string[];
  expectedResult:   string;
  acceptanceCriterionIds: string[];
  automationStatus: AutomationStatus;
}

async function generateWithLLM(
  story: UserStoryDetails,
  criteria: AcceptanceCriterion[]
): Promise<RawLLMTestCase[]> {
  if (!OPENAI_API_KEY) {
    throw new Error('[TestCaseGenerator] OPENAI_API_KEY is not set. Cannot use LLM generation.');
  }

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });

  console.log(`[TestCaseGenerator] Calling ${OPENAI_MODEL} for story #${story.id}…`);

  const completion = await client.chat.completions.create({
    model:       OPENAI_MODEL,
    max_tokens:  OPENAI_MAX_TOKENS,
    temperature: 0.3,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user',   content: buildUserPrompt(story, criteria) },
    ],
  });

  const rawContent = completion.choices[0]?.message?.content ?? '';

  // Strip accidental markdown fences the model may add despite instructions
  const cleaned = rawContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned) as RawLLMTestCase[];
  } catch {
    throw new Error(
      `[TestCaseGenerator] LLM returned non-JSON content:\n${rawContent.slice(0, 500)}`
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error('[TestCaseGenerator] LLM response is not a JSON array.');
  }

  const cases = parsed as RawLLMTestCase[];
  console.log(`[TestCaseGenerator] LLM generated ${cases.length} test cases.`);
  const validated = validateRawCases(cases, criteria);
  validateAcceptanceCoverage(validated, criteria);
  return validated;
}

// ─── Rule-Based Generation ────────────────────────────────────────────────────

/**
 * Deterministic rule-based test case generator.
 * Used by default, or when AI generation is unavailable.
 * Parses the Acceptance Criteria and Description to produce structured cases.
 */
function generateWithRules(criteria: AcceptanceCriterion[]): RawLLMTestCase[] {
  return criteria.map((criterion) => ({
    type: acceptanceCriterionType(criterion.text),
    title: `${criterion.id}: ${criterion.text}`,
    description: `Verify the requirement stated in ${criterion.id}.`,
    testSteps: [
      `Open the application feature identified by ${criterion.id}.`,
      `Carry out the action(s) stated in ${criterion.id}: ${criterion.text}`,
      `Compare the observed behavior with the requirement in ${criterion.id}.`,
    ],
    expectedResult: criterion.text,
    acceptanceCriterionIds: [criterion.id],
    automationStatus: 'Pending',
  }));
}

// ─── Assembler ────────────────────────────────────────────────────────────────

function assembleTestCases(
  story: UserStoryDetails,
  rawCases: RawLLMTestCase[],
  criteria: AcceptanceCriterion[]
): TestCase[] {
  return rawCases.map((raw, index) => ({
    id:              padId(index + 1),
    title:           raw.title,
    description:     raw.description,
    type:            raw.type,
    testSteps:       Array.isArray(raw.testSteps)
      ? raw.testSteps
      : toStepArray(String(raw.testSteps)),
    expectedResult:  raw.expectedResult,
    acceptanceCriteria: criteria.filter((criterion) =>
      raw.acceptanceCriterionIds.includes(criterion.id)
    ),
    automationMapping: null,
    actualResult:    '',            // empty until executed
    automationStatus: raw.automationStatus ?? 'Pending',
    automationRunDate: '',          // empty until executed
    storyId:         story.id,
    storyTitle:      story.title,
  }));
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * TestCaseGenerator
 *
 * Generates cases from explicit acceptance criteria. Uses the OpenAI GPT API
 * when explicitly requested; otherwise uses a deterministic rule-based engine.
 */
export class TestCaseGenerator {
  constructor(private readonly useLLM = false) {}

  /**
   * Main entry point. Automatically picks LLM or rule-based strategy.
   */
  async generate(story: UserStoryDetails): Promise<TestCaseGenerationResult> {
    console.log(`\n[TestCaseGenerator] Generating test cases for Story #${story.id}: "${story.title}"`);

    const criteria = parseAcceptanceCriteria(story);
    let rawCases: RawLLMTestCase[];
    let generatedBy: 'llm' | 'rule-based';

    const canUseLLM = this.useLLM && Boolean(OPENAI_API_KEY);

    if (canUseLLM) {
      try {
        rawCases    = await generateWithLLM(story, criteria);
        generatedBy = 'llm';
      } catch (err) {
        console.warn(
          `[TestCaseGenerator] LLM generation failed: ${(err as Error).message}. ` +
          'Falling back to rule-based generation.'
        );
        rawCases    = generateWithRules(criteria);
        generatedBy = 'rule-based';
      }
    } else {
      rawCases    = generateWithRules(criteria);
      generatedBy = 'rule-based';
    }

    rawCases = validateRawCases(rawCases, criteria);
    validateAcceptanceCoverage(rawCases, criteria);
    const testCases = assembleTestCases(story, rawCases, criteria);

    // Log summary by type
    const positive   = testCases.filter((t) => t.type === 'Positive').length;
    const negative   = testCases.filter((t) => t.type === 'Negative').length;
    const edgeCases  = testCases.filter((t) => t.type === 'Edge Case').length;
    const fieldLevel = testCases.filter((t) => t.type === 'Field-Level Validation').length;

    console.log(
      `[TestCaseGenerator] Summary — Total: ${testCases.length} ` +
      `(Functional: ${positive}, Negative: ${negative}, Edge: ${edgeCases}, Field-Level: ${fieldLevel}) ` +
      `via ${generatedBy}`
    );

    return {
      storyId:     story.id,
      storyTitle:  story.title,
      testCases,
      generatedAt: timestamp(),
      generatedBy,
    };
  }

  /**
   * Convenience: generate cases directly from story text without fetching from ADO.
   */
  async generateFromText(
    storyId: number,
    storyTitle: string,
    description: string,
    acceptanceCriteria: string
  ): Promise<TestCaseGenerationResult> {
    const mockStory: UserStoryDetails = {
      id:                 storyId,
      title:              storyTitle,
      description,
      acceptanceCriteria,
      workItemType:       'User Story',
      state:              'Active',
      areaPath:           '',
      iterationPath:      '',
      tags:               [],
      url:                '',
    };
    return this.generate(mockStory);
  }
}

/** Pre-built singleton */
export const testCaseGenerator = new TestCaseGenerator();
