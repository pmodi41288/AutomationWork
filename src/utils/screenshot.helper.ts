/**
 * screenshot.helper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised helper for full-page screenshot capture, naming, and persistence.
 * Used by the fixture layer, BasePage, and the story runner.
 */

import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import dayjs from 'dayjs';
import { SCREENSHOTS_DIR } from '../../config/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScreenshotOptions {
  /** Sub-directory inside SCREENSHOTS_DIR (e.g. 'login', 'dashboard') */
  folder?:    string;
  /** Override filename (without extension) */
  name?:      string;
  /** Prefix appended before the name: 'PASS' | 'FAIL' | 'STEP' */
  prefix?:    'PASS' | 'FAIL' | 'STEP' | string;
  /** Capture full page (default: true) */
  fullPage?:  boolean;
  /** JPEG quality 0–100 (only when type = 'jpeg') */
  quality?:   number;
  /** Image format (default: 'png') */
  type?:      'png' | 'jpeg';
}

export interface ScreenshotResult {
  filePath: string;
  buffer:   Buffer;
  fileName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitise(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function buildFileName(options: ScreenshotOptions, timestamp: string): string {
  const parts: string[] = [];
  if (options.prefix)   parts.push(options.prefix);
  if (options.name)     parts.push(sanitise(options.name));
  parts.push(timestamp);
  return `${parts.join('_')}.${options.type ?? 'png'}`;
}

function buildDir(options: ScreenshotOptions): string {
  return options.folder
    ? path.join(SCREENSHOTS_DIR, options.folder)
    : SCREENSHOTS_DIR;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── ScreenshotHelper ─────────────────────────────────────────────────────────

export class ScreenshotHelper {

  /**
   * Captures a full-page screenshot and writes it to disk.
   * Returns the file path, buffer, and file name.
   */
  async capture(page: Page, options: ScreenshotOptions = {}): Promise<ScreenshotResult> {
    const timestamp = dayjs().format('YYYYMMDD_HHmmss_SSS');
    const dir       = buildDir(options);
    const fileName  = buildFileName(options, timestamp);
    const filePath  = path.join(dir, fileName);

    ensureDir(dir);

    const buffer = await page.screenshot({
      fullPage:  options.fullPage  ?? true,
      type:      options.type      ?? 'png',
      quality:   options.quality,
      path:      filePath,
    });

    console.log(`[ScreenshotHelper] Saved: ${filePath}`);
    return { filePath, buffer, fileName };
  }

  /**
   * Captures a failure screenshot with FAIL_ prefix.
   * Intended to be called from fixture error hooks.
   */
  async captureFailure(
    page: Page,
    testTitle: string,
    folder = 'failures'
  ): Promise<ScreenshotResult> {
    return this.capture(page, {
      prefix:   'FAIL',
      name:     testTitle,
      folder,
      fullPage: true,
    });
  }

  /**
   * Captures a pass screenshot with PASS_ prefix.
   */
  async capturePass(
    page: Page,
    testTitle: string,
    folder = 'passes'
  ): Promise<ScreenshotResult> {
    return this.capture(page, {
      prefix:   'PASS',
      name:     testTitle,
      folder,
      fullPage: true,
    });
  }

  /**
   * Captures an inline step screenshot with STEP_ prefix.
   */
  async captureStep(
    page: Page,
    stepName: string,
    folder = 'steps'
  ): Promise<ScreenshotResult> {
    return this.capture(page, {
      prefix:   'STEP',
      name:     stepName,
      folder,
      fullPage: false,
    });
  }

  /**
   * Reads an already-saved screenshot from disk as a Buffer.
   */
  readFromDisk(filePath: string): Buffer {
    if (!fs.existsSync(filePath)) {
      throw new Error(`[ScreenshotHelper] File not found: ${filePath}`);
    }
    return fs.readFileSync(filePath);
  }

  /**
   * Lists all screenshot files in a directory.
   */
  listScreenshots(folder?: string): string[] {
    const dir = folder ? path.join(SCREENSHOTS_DIR, folder) : SCREENSHOTS_DIR;
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => /\.(png|jpe?g)$/i.test(f))
      .map((f) => path.join(dir, f));
  }

  /**
   * Deletes screenshots older than `maxAgeDays` days from a directory.
   */
  pruneOld(folder?: string, maxAgeDays = 7): number {
    const dir   = folder ? path.join(SCREENSHOTS_DIR, folder) : SCREENSHOTS_DIR;
    if (!fs.existsSync(dir)) return 0;

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let   count  = 0;

    fs.readdirSync(dir).forEach((f) => {
      const full  = path.join(dir, f);
      const stats = fs.statSync(full);
      if (stats.isFile() && stats.mtimeMs < cutoff) {
        fs.unlinkSync(full);
        count++;
      }
    });

    if (count > 0) {
      console.log(`[ScreenshotHelper] Pruned ${count} screenshot(s) older than ${maxAgeDays} days.`);
    }
    return count;
  }
}

/** Pre-built singleton */
export const screenshotHelper = new ScreenshotHelper();
