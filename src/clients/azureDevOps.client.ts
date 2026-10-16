import axios, { AxiosInstance, AxiosError } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';
import {
  WorkItem,
  UserStoryDetails,
  AttachmentUploadResponse,
  WorkItemUpdateResponse,
  BugPayload,
  CreatedBug,
} from '../types/index';
import {
  AZURE_DEVOPS_ORG_URL,
  AZURE_DEVOPS_PROJECT,
  AZURE_DEVOPS_AREA_PATH,
  AZURE_DEVOPS_ITERATION_PATH,
  getAzureAuthHeader,
} from '../../config/env';

// ─── Constants ────────────────────────────────────────────────────────────────

const ADO_API_VERSION         = '7.1';
const ADO_ATTACHMENT_API_VER  = '7.1';
const MAX_RETRIES             = 3;
const RETRY_DELAY_MS          = 1_500;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function extractWorkItemId(input: string): number {
  // Accept plain number or full ADO URL
  const urlMatch = input.match(/_workitems\/edit\/(\d+)/i);
  if (urlMatch) return parseInt(urlMatch[1], 10);

  const numMatch = input.match(/^\d+$/);
  if (numMatch) return parseInt(input, 10);

  throw new Error(
    `[AzureDevOpsClient] Cannot parse work item ID from: "${input}". ` +
    'Provide a numeric ID or a full Azure DevOps work item URL.'
  );
}

// ─── Client Class ─────────────────────────────────────────────────────────────

/**
 * AzureDevOpsClient
 *
 * Wraps the Azure DevOps REST API v7.1 for work-item reads, attachment
 * uploads, bug creation, and history comments. All methods include
 * automatic retry with exponential back-off on transient errors.
 */
export class AzureDevOpsClient {
  private readonly http: AxiosInstance;
  private readonly orgUrl: string;
  private readonly project: string;

  constructor() {
    this.orgUrl  = AZURE_DEVOPS_ORG_URL;
    this.project = AZURE_DEVOPS_PROJECT;

    if (!this.orgUrl || !this.project) {
      throw new Error(
        '[AzureDevOpsClient] AZURE_DEVOPS_ORG_URL and AZURE_DEVOPS_PROJECT must be set in .env'
      );
    }

    this.http = axios.create({
      baseURL: `${this.orgUrl}/${this.project}/_apis`,
      headers: {
        Authorization: getAzureAuthHeader(),
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });

    // Response interceptor — log errors clearly
    this.http.interceptors.response.use(
      (res) => res,
      (err: AxiosError) => {
        const status  = err.response?.status;
        const message = (err.response?.data as { message?: string })?.message ?? err.message;
        console.error(`[AzureDevOps] HTTP ${status ?? 'ERR'}: ${message}`);
        return Promise.reject(err);
      }
    );
  }

  // ─── Private: Retry Wrapper ────────────────────────────────────────────────

  private async withRetry<T>(
    fn: () => Promise<T>,
    label: string,
    retries = MAX_RETRIES
  ): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const isLast  = attempt === retries;
        const status  = (err as AxiosError).response?.status;
        const isRetry = status === 429 || status === 503 || status === 502 || !status;

        if (isLast || !isRetry) {
          throw err;
        }

        const delay = RETRY_DELAY_MS * attempt;
        console.warn(`[AzureDevOps] ${label} — attempt ${attempt} failed (${status}). Retrying in ${delay}ms…`);
        await sleep(delay);
      }
    }
    // TypeScript: unreachable, but satisfies return type
    throw new Error(`[AzureDevOps] ${label} exhausted all retries`);
  }

  // ─── Work Item: Fetch ──────────────────────────────────────────────────────

  /**
   * Fetches a raw Azure DevOps Work Item by its numeric ID.
   */
  async getWorkItem(idOrUrl: string | number): Promise<WorkItem> {
    const id = typeof idOrUrl === 'number' ? idOrUrl : extractWorkItemId(String(idOrUrl));

    return this.withRetry(async () => {
      const response = await this.http.get<WorkItem>(
        `/wit/workitems/${id}`,
        {
          params: {
            'api-version': ADO_API_VERSION,
            '$expand':     'all',
          },
        }
      );
      return response.data;
    }, `getWorkItem(${id})`);
  }

  /**
   * Fetches and normalises a User Story into a clean `UserStoryDetails` object.
   */
  async getUserStoryDetails(idOrUrl: string | number): Promise<UserStoryDetails> {
    const item   = await this.getWorkItem(idOrUrl);
    const fields = item.fields;

    const rawDescription = fields['System.Description'] ?? '';
    const rawAC          = fields['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? '';
    const rawTags        = fields['System.Tags'] ?? '';

    return {
      id:                 item.id,
      title:              fields['System.Title'],
      description:        stripHtml(rawDescription),
      acceptanceCriteria: stripHtml(rawAC),
      workItemType:       fields['System.WorkItemType'],
      state:              fields['System.State'],
      areaPath:           fields['System.AreaPath'],
      iterationPath:      fields['System.IterationPath'],
      tags:               rawTags
        ? rawTags.split(';').map((t: string) => t.trim()).filter(Boolean)
        : [],
      url: `${this.orgUrl}/${this.project}/_workitems/edit/${item.id}`,
    };
  }

  // ─── Attachments ──────────────────────────────────────────────────────────

  /**
   * Uploads a local file as an attachment to Azure DevOps.
   * Returns the attachment metadata (id, url).
   */
  async uploadAttachment(
    filePath: string,
    fileName?: string
  ): Promise<AttachmentUploadResponse> {
    const resolvedPath = path.resolve(filePath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`[AzureDevOps] Attachment file not found: ${resolvedPath}`);
    }

    const name        = fileName ?? path.basename(resolvedPath);
    const fileBuffer  = fs.readFileSync(resolvedPath);
    const mimeType    = this.getMimeType(resolvedPath);

    return this.withRetry(async () => {
      const response = await this.http.post<AttachmentUploadResponse>(
        `/wit/attachments`,
        fileBuffer,
        {
          params: {
            'api-version': ADO_ATTACHMENT_API_VER,
            fileName:      name,
          },
          headers: {
            Authorization:  getAzureAuthHeader(),
            'Content-Type': 'application/octet-stream',
          },
        }
      );
      console.log(`[AzureDevOps] Uploaded attachment: ${name} → ${response.data.url}`);
      return response.data;
    }, `uploadAttachment(${name})`);
  }

  /**
   * Links an already-uploaded attachment to a specific Work Item.
   */
  async addAttachmentToWorkItem(
    workItemId: number,
    attachmentUrl: string,
    fileName: string,
    comment = 'Attached by sketchplay-qa-agent'
  ): Promise<WorkItemUpdateResponse> {
    const patchDoc = [
      {
        op:    'add',
        path:  '/relations/-',
        value: {
          rel:        'AttachedFile',
          url:        attachmentUrl,
          attributes: { comment },
        },
      },
    ];

    return this.withRetry(async () => {
      const response = await this.http.patch<WorkItemUpdateResponse>(
        `/wit/workitems/${workItemId}`,
        patchDoc,
        {
          params:  { 'api-version': ADO_API_VERSION },
          headers: {
            Authorization:  getAzureAuthHeader(),
            'Content-Type': 'application/json-patch+json',
          },
        }
      );
      console.log(`[AzureDevOps] Linked "${fileName}" to work item #${workItemId}`);
      return response.data;
    }, `addAttachmentToWorkItem(${workItemId})`);
  }

  /**
   * Convenience: uploads a local file AND links it to the work item in one call.
   */
  async uploadAndAttach(
    workItemId: number,
    filePath: string,
    comment?: string
  ): Promise<AttachmentUploadResponse> {
    const attachment = await this.uploadAttachment(filePath);
    await this.addAttachmentToWorkItem(
      workItemId,
      attachment.url,
      path.basename(filePath),
      comment
    );
    return attachment;
  }

  // ─── Work Item: Update History/Comment ────────────────────────────────────

  /**
   * Adds an HTML comment/discussion entry to a Work Item's history.
   */
  async addComment(workItemId: number, commentHtml: string): Promise<WorkItemUpdateResponse> {
    const patchDoc = [
      {
        op:    'add',
        path:  '/fields/System.History',
        value: commentHtml,
      },
    ];

    return this.withRetry(async () => {
      const response = await this.http.patch<WorkItemUpdateResponse>(
        `/wit/workitems/${workItemId}`,
        patchDoc,
        {
          params:  { 'api-version': ADO_API_VERSION },
          headers: {
            Authorization:  getAzureAuthHeader(),
            'Content-Type': 'application/json-patch+json',
          },
        }
      );
      console.log(`[AzureDevOps] Added comment to work item #${workItemId}`);
      return response.data;
    }, `addComment(${workItemId})`);
  }

  // ─── Work Item: Update Fields ──────────────────────────────────────────────

  /**
   * Generic field-level patch. Pass a map of ADO field paths → values.
   * e.g. { '/fields/System.State': 'Active' }
   */
  async updateFields(
    workItemId: number,
    fields: Record<string, unknown>
  ): Promise<WorkItemUpdateResponse> {
    const patchDoc = Object.entries(fields).map(([path_, value]) => ({
      op:    'add',
      path:  path_,
      value,
    }));

    return this.withRetry(async () => {
      const response = await this.http.patch<WorkItemUpdateResponse>(
        `/wit/workitems/${workItemId}`,
        patchDoc,
        {
          params:  { 'api-version': ADO_API_VERSION },
          headers: {
            Authorization:  getAzureAuthHeader(),
            'Content-Type': 'application/json-patch+json',
          },
        }
      );
      return response.data;
    }, `updateFields(${workItemId})`);
  }

  // ─── Bug: Create ──────────────────────────────────────────────────────────

  /**
   * Creates a Bug work item linked as a child to the parent User Story.
   * Uploads screenshot and video attachments if paths are provided.
   */
  async createBug(
    payload: BugPayload,
    screenshotPath?: string,
    videoPath?: string
  ): Promise<CreatedBug> {
    const areaPath      = payload.areaPath      || AZURE_DEVOPS_AREA_PATH;
    const iterationPath = payload.iterationPath || AZURE_DEVOPS_ITERATION_PATH;

    const descriptionHtml = `
      <h3>User Story Reference</h3>
      <p>Parent Story ID: <strong>#${payload.parentStoryId}</strong></p>
      <p>${payload.description}</p>

      <h3>System Information</h3>
      <p>${payload.systemInfo}</p>
    `.trim();

    const stepsHtml = `
      <h3>Steps to Reproduce</h3>
      <pre>${payload.stepsToReproduce}</pre>
    `.trim();

    const patchDoc = [
      { op: 'add', path: '/fields/System.Title',
        value: payload.title },
      { op: 'add', path: '/fields/System.Description',
        value: descriptionHtml },
      { op: 'add', path: '/fields/Microsoft.VSTS.TCM.ReproSteps',
        value: stepsHtml },
      { op: 'add', path: '/fields/Microsoft.VSTS.TCM.SystemInfo',
        value: payload.systemInfo },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority',
        value: 1 },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.Severity',
        value: '2 - High' },
      { op: 'add', path: '/fields/System.State',
        value: 'New' },
      { op: 'add', path: '/fields/System.AreaPath',
        value: areaPath },
      { op: 'add', path: '/fields/System.IterationPath',
        value: iterationPath },
      { op: 'add', path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria',
        value: `<p><strong>Expected:</strong> ${payload.expectedResult}</p>` },
      // Link to parent User Story
      {
        op:    'add',
        path:  '/relations/-',
        value: {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: `${this.orgUrl}/${this.project}/_apis/wit/workitems/${payload.parentStoryId}`,
          attributes: { comment: 'Auto-linked by sketchplay-qa-agent' },
        },
      },
    ];

    const createdItem = await this.withRetry(async () => {
      const response = await this.http.post<WorkItem>(
        `/wit/workitems/$Bug`,
        patchDoc,
        {
          params:  { 'api-version': ADO_API_VERSION },
          headers: {
            Authorization:  getAzureAuthHeader(),
            'Content-Type': 'application/json-patch+json',
          },
        }
      );
      return response.data;
    }, `createBug("${payload.title}")`);

    console.log(`[AzureDevOps] Created Bug #${createdItem.id}: ${payload.title}`);

    const attachmentUrls: string[] = [];

    // Upload and link screenshot
    if (screenshotPath && fs.existsSync(screenshotPath)) {
      try {
        const att = await this.uploadAndAttach(
          createdItem.id,
          screenshotPath,
          'Failure screenshot — auto-attached by sketchplay-qa-agent'
        );
        attachmentUrls.push(att.url);
      } catch (e) {
        console.warn(`[AzureDevOps] Failed to attach screenshot: ${(e as Error).message}`);
      }
    }

    // Upload and link video
    if (videoPath && fs.existsSync(videoPath)) {
      try {
        const att = await this.uploadAndAttach(
          createdItem.id,
          videoPath,
          'Failure video recording — auto-attached by sketchplay-qa-agent'
        );
        attachmentUrls.push(att.url);
      } catch (e) {
        console.warn(`[AzureDevOps] Failed to attach video: ${(e as Error).message}`);
      }
    }

    return {
      id:             createdItem.id,
      title:          payload.title,
      url:            `${this.orgUrl}/${this.project}/_workitems/edit/${createdItem.id}`,
      attachmentUrls,
    };
  }

  // ─── Work Item: Fetch Attachments ──────────────────────────────────────────

  /**
   * Returns all attachment relations on a work item.
   */
  async getAttachments(workItemId: number): Promise<{ name: string; url: string }[]> {
    const item = await this.getWorkItem(workItemId);

    // Relations are only present on the full expand
    const rawItem = item as WorkItem & {
      relations?: Array<{ rel: string; url: string; attributes?: { name?: string } }>;
    };

    return (rawItem.relations ?? [])
      .filter((r) => r.rel === 'AttachedFile')
      .map((r) => ({
        name: r.attributes?.name ?? path.basename(r.url),
        url:  r.url,
      }));
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  private getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      '.png':  'image/png',
      '.jpg':  'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webm': 'video/webm',
      '.mp4':  'video/mp4',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.pdf':  'application/pdf',
      '.txt':  'text/plain',
      '.log':  'text/plain',
      '.zip':  'application/zip',
    };
    return map[ext] ?? 'application/octet-stream';
  }

  /**
   * Health-check: verifies the PAT and organisation URL are valid.
   */
  async ping(): Promise<boolean> {
    try {
      await this.http.get('/projects', {
        params: { 'api-version': ADO_API_VERSION, '$top': 1 },
        headers: { Authorization: getAzureAuthHeader() },
      });
      return true;
    } catch {
      return false;
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

/** Pre-built singleton — import directly for convenience */
export const adoClient = new AzureDevOpsClient();
