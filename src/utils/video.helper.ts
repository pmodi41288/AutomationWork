/**
 * video.helper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised helper for Playwright video recording management.
 * Handles path resolution, copying to permanent storage, and pruning.
 */

import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import dayjs from 'dayjs';
import { VIDEOS_DIR } from '../../config/env';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VideoResult {
  sourcePath: string;   // Playwright's temp path
  savedPath:  string;   // Permanent path in test-artifacts/videos
  fileName:   string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitise(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── VideoHelper ──────────────────────────────────────────────────────────────

export class VideoHelper {

  /**
   * Resolves the Playwright-managed temp video path for a page.
   * NOTE: The video file is only fully written after page.close().
   * Call this BEFORE closing the page to get the path, then
   * call saveVideo() AFTER page.close() to copy the file.
   */
  async getVideoPath(page: Page): Promise<string | null> {
    try {
      const video = page.video();
      if (!video) return null;
      return await video.path();
    } catch {
      return null;
    }
  }

  /**
   * Waits for Playwright to finish writing the video file and
   * copies it to the permanent videos directory.
   *
   * @param tempPath   Path returned by page.video().path()
   * @param testTitle  Used to build a human-readable filename
   * @param prefix     'FAIL' | 'PASS' | 'RUN'
   */
  async saveVideo(
    tempPath: string,
    testTitle: string,
    prefix: 'FAIL' | 'PASS' | 'RUN' = 'RUN',
    folder?: string
  ): Promise<VideoResult | null> {
    if (!tempPath || !fs.existsSync(tempPath)) {
      console.warn(`[VideoHelper] Temp video not found: ${tempPath}`);
      return null;
    }

    const timestamp = dayjs().format('YYYYMMDD_HHmmss');
    const fileName  = `${prefix}_${sanitise(testTitle)}_${timestamp}.webm`;
    const dir       = folder ? path.join(VIDEOS_DIR, folder) : VIDEOS_DIR;
    const savedPath = path.join(dir, fileName);

    ensureDir(dir);

    // Copy from Playwright temp location to permanent location
    fs.copyFileSync(tempPath, savedPath);
    console.log(`[VideoHelper] Saved: ${savedPath}`);

    return { sourcePath: tempPath, savedPath, fileName };
  }

  /**
   * Convenience: resolve path + save in one call for failure scenarios.
   * Should be called AFTER page.close() to ensure the file is fully written.
   */
  async captureFailureVideo(
    page: Page,
    testTitle: string
  ): Promise<VideoResult | null> {
    const tempPath = await this.getVideoPath(page);
    if (!tempPath) {
      console.warn('[VideoHelper] No video recording available for this page.');
      return null;
    }

    // Brief wait for Playwright to finish flushing the video
    await new Promise((r) => setTimeout(r, 500));

    return this.saveVideo(tempPath, testTitle, 'FAIL', 'failures');
  }

  /**
   * Lists all video files in the videos directory.
   */
  listVideos(folder?: string): string[] {
    const dir = folder ? path.join(VIDEOS_DIR, folder) : VIDEOS_DIR;
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => /\.webm$/i.test(f))
      .map((f) => path.join(dir, f));
  }

  /**
   * Deletes video files older than `maxAgeDays` days.
   */
  pruneOld(folder?: string, maxAgeDays = 7): number {
    const dir   = folder ? path.join(VIDEOS_DIR, folder) : VIDEOS_DIR;
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
      console.log(`[VideoHelper] Pruned ${count} video(s) older than ${maxAgeDays} days.`);
    }
    return count;
  }

  /**
   * Returns file size in MB for a given video path.
   */
  getFileSizeMB(filePath: string): number {
    if (!fs.existsSync(filePath)) return 0;
    return fs.statSync(filePath).size / (1024 * 1024);
  }
}

/** Pre-built singleton */
export const videoHelper = new VideoHelper();
