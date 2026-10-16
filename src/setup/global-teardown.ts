/**
 * global-teardown.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs once after the entire test suite completes.
 * Responsibilities:
 *   1. Log test run completion timestamp
 *   2. Clean up any temporary files if needed
 *   3. Write final Allure executor info
 */

import { FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ALLURE_RESULTS_DIR } from '../../config/env';

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  console.log('\n[global-teardown] ═══ Starting global teardown ═══');

  try {
    const allureDir = path.resolve(process.cwd(), ALLURE_RESULTS_DIR);

    if (fs.existsSync(allureDir)) {
      // Write executor.json for Allure CI integration
      const executor = {
        name:      'sketchplay-qa-agent',
        type:      'local',
        buildName: `Run ${new Date().toISOString()}`,
        buildUrl:  process.env.BUILD_URL ?? '',
        reportUrl: process.env.ALLURE_REPORT_URL ?? '',
      };

      fs.writeFileSync(
        path.join(allureDir, 'executor.json'),
        JSON.stringify(executor, null, 2),
        'utf-8'
      );
    }
  } catch (err) {
    // Non-fatal — teardown should not fail the suite
    console.warn(`[global-teardown] Warning: ${(err as Error).message}`);
  }

  console.log(`[global-teardown] Completed at ${new Date().toISOString()}`);
  console.log('[global-teardown] ═══ Global teardown complete ═══\n');
}
