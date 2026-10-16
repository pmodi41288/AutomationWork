import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseAcceptanceCriteria, TestCaseGenerator } from './testCaseGenerator';
import { UserStoryDetails } from '../types/index';

function makeStory(acceptanceCriteria: string, description = ''): UserStoryDetails {
  return {
    id: 27531,
    title: 'QA generator fixture',
    description,
    acceptanceCriteria,
    workItemType: 'User Story',
    state: 'Active',
    areaPath: '',
    iterationPath: '',
    tags: [],
    url: '',
  };
}

describe('test case generation traceability', () => {
  it('parses HTML list criteria and assigns stable sequential references', () => {
    const criteria = parseAcceptanceCriteria(makeStory(
      '<ul><li>AC 4: A user can search the list.</li>' +
      '<li>AC 7: No matching results are shown.</li></ul>'
    ));

    assert.deepEqual(criteria, [
      { id: 'AC1', text: 'A user can search the list.' },
      { id: 'AC2', text: 'No matching results are shown.' },
    ]);
  });

  it('keeps a Gherkin scenario and its steps together as one criterion', () => {
    const criteria = parseAcceptanceCriteria(makeStory(
      'Scenario: Successful sign in\n' +
      'Given valid credentials\n' +
      'When the user submits the login form\n' +
      'Then the user reaches the dashboard'
    ));

    assert.equal(criteria.length, 1);
    assert.equal(criteria[0].id, 'AC1');
    assert.match(criteria[0].text, /Given valid credentials.*Then the user reaches the dashboard/);
  });

  it('rejects missing acceptance criteria instead of using the story description', async () => {
    const generator = new TestCaseGenerator();

    await assert.rejects(
      generator.generate(makeStory('', 'The description mentions a login feature.')),
      /no Acceptance Criteria/
    );
  });

  it('maps every generated case to its exact criterion without adding keyword-based cases', async () => {
    const result = await new TestCaseGenerator().generate(makeStory(
      'A user can search the list.'
    ));

    assert.equal(result.testCases.length, 1);
    assert.equal(result.testCases[0].title, 'AC1: A user can search the list.');
    assert.deepEqual(result.testCases[0].acceptanceCriteria, [
      { id: 'AC1', text: 'A user can search the list.' },
    ]);
    assert.equal(result.testCases[0].expectedResult, 'A user can search the list.');
    assert.ok(result.testCases[0].testSteps.every((step) => !/team-name|games list/i.test(step)));
  });
});
