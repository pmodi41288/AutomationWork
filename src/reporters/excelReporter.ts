import ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import dayjs from 'dayjs';
import {
  TestCase,
  TestExecutionRecord,
  TestCaseGenerationResult,
  AutomationStatus,
} from '../types/index';
import { EXCEL_DIR } from '../../config/env';

// ─── Column Definitions ───────────────────────────────────────────────────────
// Exact column order specified in the requirement

interface ColumnDef {
  header: string;
  key:    string;
  width:  number;
}

const COLUMNS: ColumnDef[] = [
  { header: 'Test Case ID',           key: 'testCaseId',             width: 14 },
  { header: 'Test Case Title',        key: 'testCaseTitle',          width: 55 },
  { header: 'Acceptance Criteria',     key: 'acceptanceCriteria',     width: 60 },
  { header: 'Test Case Description',  key: 'testCaseDescription',    width: 55 },
  { header: 'Test Steps',             key: 'testSteps',              width: 70 },
  { header: 'Expected Result',        key: 'expectedResult',         width: 55 },
  { header: 'Actual Result',          key: 'actualResult',           width: 55 },
  { header: 'QA Automation Status',   key: 'qaAutomationStatus',     width: 22 },
  { header: 'Automation Test Run Date', key: 'automationTestRunDate', width: 24 },
];

// ─── Theme ────────────────────────────────────────────────────────────────────

const THEME = {
  header: {
    fill:   '1E3A5F',   // Deep navy
    font:   'FFFFFF',
    border: '2E75B6',
  },
  positive:       { fill: 'E8F5E9', badge: '2E7D32' },  // Green tint
  negative:       { fill: 'FFEBEE', badge: 'C62828' },  // Red tint
  edgeCase:       { fill: 'EDE7F6', badge: '4527A0' },  // Purple tint
  fieldLevel:     { fill: 'FFF8E1', badge: 'F57F17' },  // Amber tint
  pass:           { fill: 'E8F5E9', font: '1B5E20' },
  fail:           { fill: 'FFEBEE', font: 'B71C1C' },
  pending:        { fill: 'FFF8E1', font: '4E342E' },
  defaultBg:      'FFFFFF',
  altRowBg:       'F5F9FF',
  borderColor:    'BDD7EE',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function formatSteps(steps: string[]): string {
  return steps
    .map((step, i) => `${i + 1}. ${step}`)
    .join('\n');
}

function getRowFill(
  type: string,
  result: string,
  rowIndex: number
): string {
  if (result === 'Pass') return THEME.pass.fill;
  if (result === 'Fail') return THEME.fail.fill;

  if (type === 'Positive') return THEME.positive.fill;
  if (type === 'Negative') return THEME.negative.fill;
  if (type === 'Edge Case') return THEME.edgeCase.fill;
  if (type === 'Field-Level Validation') return THEME.fieldLevel.fill;

  return rowIndex % 2 === 0 ? THEME.defaultBg : THEME.altRowBg;
}

function getStatusColor(status: AutomationStatus | string): string {
  const map: Record<string, string> = {
    'Automated':        '1B5E20',
    'Pending':          'E65100',
    'Manual':           '0D47A1',
    'Not Automatable':  '37474F',
    'Pass':             '1B5E20',
    'Fail':             'B71C1C',
    'Skipped':          '4527A0',
  };
  return map[status] ?? '000000';
}

function applyBorder(
  cell: ExcelJS.Cell,
  color = THEME.borderColor,
  style: ExcelJS.BorderStyle = 'thin'
): void {
  const border: Partial<ExcelJS.Borders> = {
    top:    { style, color: { argb: `FF${color}` } },
    left:   { style, color: { argb: `FF${color}` } },
    bottom: { style, color: { argb: `FF${color}` } },
    right:  { style, color: { argb: `FF${color}` } },
  };
  cell.border = border;
}

// ─── ExcelReporter ────────────────────────────────────────────────────────────

/**
 * ExcelReporter
 *
 * Generates and updates a styled .xlsx test case report using ExcelJS.
 * Column schema (exact order):
 *   Test Case ID | Test Case Description | Test Steps |
 *   Expected Result | Actual Result | QA Automation Status | Automation Test Run Date
 */
export class ExcelReporter {
  private readonly outputDir: string;

  constructor(outputDir?: string) {
    this.outputDir = outputDir ?? EXCEL_DIR;
    ensureDir(this.outputDir);
  }

  // ─── Build File Path ────────────────────────────────────────────────────────

  buildFilePath(storyId: number, storyTitle: string): string {
    const sanitisedTitle = storyTitle
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 40);
    const timestamp = dayjs().format('YYYYMMDD_HHmmss_SSS');
    const baseName  = `TC_Story${storyId}_${sanitisedTitle}_${timestamp}`;
    let filePath    = path.join(this.outputDir, `${baseName}.xlsx`);
    let suffix      = 1;

    while (fs.existsSync(filePath)) {
      suffix++;
      filePath = path.join(this.outputDir, `${baseName}_${suffix}.xlsx`);
    }

    return filePath;
  }

  // ─── Create Workbook ────────────────────────────────────────────────────────

  private createWorkbook(storyId: number, storyTitle: string): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();

    workbook.creator  = 'sketchplay-qa-agent';
    workbook.created  = new Date();
    workbook.modified = new Date();
    workbook.properties.date1904 = false;

    // Custom property for traceability
    workbook.calcProperties.fullCalcOnLoad = true;

    return workbook;
  }

  // ─── Apply Header Row ───────────────────────────────────────────────────────

  private applyHeaderRow(worksheet: ExcelJS.Worksheet): void {
    const headerRow = worksheet.getRow(1);
    headerRow.height = 32;

    COLUMNS.forEach((col, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = col.header;

      cell.font = {
        name:  'Calibri',
        bold:  true,
        size:  11,
        color: { argb: `FF${THEME.header.font}` },
      };

      cell.fill = {
        type:    'pattern',
        pattern: 'solid',
        fgColor: { argb: `FF${THEME.header.fill}` },
      };

      cell.alignment = {
        vertical:   'middle',
        horizontal: 'center',
        wrapText:   false,
      };

      applyBorder(cell, THEME.header.border, 'medium');
    });

    worksheet.getRow(1).commit();
  }

  // ─── Write Test Case Rows ───────────────────────────────────────────────────

  private writeTestCaseRow(
    worksheet: ExcelJS.Worksheet,
    tc: TestCase,
    execution: TestExecutionRecord | undefined,
    rowIndex: number
  ): void {
    const actualResult    = execution?.error ?? tc.actualResult ?? '';
    const status          = execution
      ? (execution.result === 'Pass' ? 'Automated' : 'Automated') as AutomationStatus
      : tc.automationStatus;
    const runDate         = execution?.runDate ?? tc.automationRunDate ?? '';
    const displayResult   = execution?.result ?? '';

    const rowData = {
      testCaseId:            tc.id,
      testCaseTitle:         tc.title,
      acceptanceCriteria:    tc.acceptanceCriteria
        .map((criterion) => `${criterion.id}: ${criterion.text}`)
        .join('\n'),
      testCaseDescription:   `[${tc.type}] ${tc.description}`,
      testSteps:             formatSteps(tc.testSteps),
      expectedResult:        tc.expectedResult,
      actualResult:          actualResult,
      qaAutomationStatus:    displayResult || status,
      automationTestRunDate: runDate,
    };

    const row       = worksheet.getRow(rowIndex);
    const fillColor = getRowFill(tc.type, displayResult, rowIndex);

    COLUMNS.forEach((col, idx) => {
      const cell  = row.getCell(idx + 1);
      const value = rowData[col.key as keyof typeof rowData];

      cell.value = value;

      cell.font = {
        name: 'Calibri',
        size: 10,
        color: col.key === 'qaAutomationStatus'
          ? { argb: `FF${getStatusColor(String(value))}` }
          : { argb: 'FF000000' },
        bold: col.key === 'qaAutomationStatus',
      };

      cell.fill = {
        type:    'pattern',
        pattern: 'solid',
        fgColor: { argb: `FF${fillColor}` },
      };

      cell.alignment = {
        vertical:   'top',
        horizontal: col.key === 'testCaseId' ? 'center' : 'left',
        wrapText:   true,
      };

      applyBorder(cell);
    });

    // Set row height based on number of steps
    const stepCount = tc.testSteps.length;
    row.height      = Math.max(20, stepCount * 16);
    row.commit();
  }

  // ─── Build Summary Sheet ────────────────────────────────────────────────────

  private addSummarySheet(
    workbook: ExcelJS.Workbook,
    storyId: number,
    storyTitle: string,
    testCases: TestCase[],
    executions: TestExecutionRecord[]
  ): void {
    const ws = workbook.addWorksheet('Summary', {
      properties: { tabColor: { argb: 'FF1E3A5F' } },
    });

    ws.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value',  key: 'value',  width: 30 },
    ];

    const passed  = executions.filter((e) => e.result === 'Pass').length;
    const failed  = executions.filter((e) => e.result === 'Fail').length;
    const skipped = executions.filter((e) => e.result === 'Skipped').length;

    const positive   = testCases.filter((t) => t.type === 'Positive').length;
    const negative   = testCases.filter((t) => t.type === 'Negative').length;
    const edgeCases  = testCases.filter((t) => t.type === 'Edge Case').length;
    const fieldLevel = testCases.filter((t) => t.type === 'Field-Level Validation').length;

    const summaryData = [
      ['Report Generated',        dayjs().format('YYYY-MM-DD HH:mm:ss')],
      ['Story ID',                `#${storyId}`],
      ['Story Title',             storyTitle],
      ['Total Test Cases',        testCases.length],
      ['Functional Cases',        positive],
      ['Negative Cases',          negative],
      ['Edge Cases',              edgeCases],
      ['Field-Level Validations', fieldLevel],
      ['Tests Executed',          executions.length],
      ['Passed',                  passed],
      ['Failed',                  failed],
      ['Skipped',                 skipped],
      ['Pass Rate',               executions.length > 0
        ? `${Math.round((passed / executions.length) * 100)}%`
        : 'N/A'],
      ['Generated By',            'sketchplay-qa-agent v1.0'],
    ];

    // Header
    const headerRow = ws.getRow(1);
    ['Metric', 'Value'].forEach((h, idx) => {
      const cell     = headerRow.getCell(idx + 1);
      cell.value     = h;
      cell.font      = { bold: true, color: { argb: `FF${THEME.header.font}` }, size: 11 };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${THEME.header.fill}` } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      applyBorder(cell, THEME.header.border, 'medium');
    });
    headerRow.height = 28;
    headerRow.commit();

    // Data rows
    summaryData.forEach(([metric, value], i) => {
      const row = ws.getRow(i + 2);
      const bg  = i % 2 === 0 ? THEME.defaultBg : THEME.altRowBg;

      const m = row.getCell(1);
      m.value     = metric;
      m.font      = { name: 'Calibri', bold: true, size: 10 };
      m.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bg}` } };
      m.alignment = { vertical: 'middle' };
      applyBorder(m);

      const v = row.getCell(2);
      v.value     = value;
      v.font      = { name: 'Calibri', size: 10 };
      v.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${bg}` } };
      v.alignment = { vertical: 'middle' };
      applyBorder(v);

      row.height = 20;
      row.commit();
    });
  }

  // ─── Generate Report ────────────────────────────────────────────────────────

  /**
   * Generates a new Excel workbook from a TestCaseGenerationResult.
   * Returns the absolute file path of the saved .xlsx file.
   */
  async generate(
    result: TestCaseGenerationResult,
    executions: TestExecutionRecord[] = []
  ): Promise<string> {
    const { storyId, storyTitle, testCases } = result;

    console.log(`\n[ExcelReporter] Generating Excel report for Story #${storyId}…`);

    const workbook    = this.createWorkbook(storyId, storyTitle);
    const filePath    = this.buildFilePath(storyId, storyTitle);

    // ── Main Test Cases Sheet ───────────────────────────────────────────────
    const ws = workbook.addWorksheet('Test Cases', {
      properties: { tabColor: { argb: 'FF2E75B6' } },
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    // Set column widths
    ws.columns = COLUMNS.map((col) => ({
      key:   col.key,
      width: col.width,
    }));

    // Header
    this.applyHeaderRow(ws);

    // Auto-filter on header row
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: 1, column: COLUMNS.length },
    };

    // Data rows
    const executionMap = new Map<string, TestExecutionRecord>(
      executions.map((e) => [e.testCaseId, e])
    );

    testCases.forEach((tc, index) => {
      this.writeTestCaseRow(
        ws,
        tc,
        executionMap.get(tc.id),
        index + 2  // row 1 = header
      );
    });

    // ── Summary Sheet ───────────────────────────────────────────────────────
    this.addSummarySheet(workbook, storyId, storyTitle, testCases, executions);

    // ── Write File ──────────────────────────────────────────────────────────
    await workbook.xlsx.writeFile(filePath);

    const stats = fs.statSync(filePath);
    console.log(
      `[ExcelReporter] Saved: ${filePath} (${(stats.size / 1024).toFixed(1)} KB)`
    );

    return filePath;
  }

  // ─── Update Existing Report ─────────────────────────────────────────────────

  /**
   * Opens an existing .xlsx file and updates the Actual Result,
   * QA Automation Status, and Automation Test Run Date columns
   * for test cases that have execution records.
   */
  async updateWithResults(
    filePath: string,
    executions: TestExecutionRecord[]
  ): Promise<string> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`[ExcelReporter] File not found: ${filePath}`);
    }

    console.log(`[ExcelReporter] Updating results in: ${filePath}`);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const ws = workbook.getWorksheet('Test Cases');
    if (!ws) {
      throw new Error('[ExcelReporter] "Test Cases" sheet not found in workbook.');
    }

    const executionMap = new Map<string, TestExecutionRecord>(
      executions.map((e) => [e.testCaseId, e])
    );

    // Column index map (1-based)
    const colIndex: Record<string, number> = {};
    ws.getRow(1).eachCell((cell, colNum) => {
      colIndex[String(cell.value)] = colNum;
    });

    const actualResultCol = colIndex['Actual Result'];
    const statusCol       = colIndex['QA Automation Status'];
    const runDateCol      = colIndex['Automation Test Run Date'];
    const idCol           = colIndex['Test Case ID'];

    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return; // skip header

      const tcId = String(row.getCell(idCol).value ?? '');
      const exec  = executionMap.get(tcId);
      if (!exec) return;

      // Update Actual Result
      if (actualResultCol) {
        const cell  = row.getCell(actualResultCol);
        cell.value  = exec.error ?? (exec.result === 'Pass' ? 'Test passed as expected' : '');
        cell.fill   = {
          type:    'pattern',
          pattern: 'solid',
          fgColor: { argb: exec.result === 'Pass' ? `FF${THEME.pass.fill}` : `FF${THEME.fail.fill}` },
        };
        applyBorder(cell);
      }

      // Update Status
      if (statusCol) {
        const cell  = row.getCell(statusCol);
        cell.value  = exec.result;
        cell.font   = {
          name:  'Calibri',
          bold:  true,
          size:  10,
          color: { argb: `FF${getStatusColor(exec.result)}` },
        };
        cell.fill   = {
          type:    'pattern',
          pattern: 'solid',
          fgColor: { argb: exec.result === 'Pass' ? `FF${THEME.pass.fill}` : `FF${THEME.fail.fill}` },
        };
        applyBorder(cell);
      }

      // Update Run Date
      if (runDateCol) {
        const cell  = row.getCell(runDateCol);
        cell.value  = exec.runDate;
        cell.fill   = {
          type:    'pattern',
          pattern: 'solid',
          fgColor: { argb: exec.result === 'Pass' ? `FF${THEME.pass.fill}` : `FF${THEME.fail.fill}` },
        };
        applyBorder(cell);
      }

      row.commit();
    });

    // Overwrite the same file
    await workbook.xlsx.writeFile(filePath);
    console.log(`[ExcelReporter] Updated: ${filePath}`);
    return filePath;
  }
}

/** Pre-built singleton */
export const excelReporter = new ExcelReporter();
