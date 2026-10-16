import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env from project root — must happen before any config reads
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `[env] Required environment variable "${key}" is not set. ` +
      `Copy .env.example to .env and fill in your values.`
    );
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function boolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === 'true' || raw === '1';
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? fallback : parsed;
}

// ─── Environment ──────────────────────────────────────────────────────────────

export type TestEnvironment = 'dev' | 'stage' | 'production';

export const TEST_ENV = optionalEnv('TEST_ENV', 'dev') as TestEnvironment;
export const IS_CI    = boolEnv('CI', false);

// ─── Application URLs ─────────────────────────────────────────────────────────

export const WEB_BASE_URL        = optionalEnv('WEB_BASE_URL', 'http://localhost:4200');
export const MOTHERSHIP_BASE_URL = optionalEnv('MOTHERSHIP_BASE_URL', 'http://localhost:4300');

// ─── Web Portal Credentials ───────────────────────────────────────────────────

export const WEB_USER_EMAIL    = optionalEnv('WEB_USER_EMAIL', '');
export const WEB_USER_PASSWORD = optionalEnv('WEB_USER_PASSWORD', '');

// ─── Mothership Portal Credentials ────────────────────────────────────────────

export const MOTHERSHIP_USER_EMAIL    = optionalEnv('MOTHERSHIP_USER_EMAIL', '');
export const MOTHERSHIP_USER_PASSWORD = optionalEnv('MOTHERSHIP_USER_PASSWORD', '');

// ─── Azure DevOps ─────────────────────────────────────────────────────────────

export const AZURE_DEVOPS_ORG_URL       = optionalEnv('AZURE_DEVOPS_ORG_URL', '');
export const AZURE_DEVOPS_PROJECT       = optionalEnv('AZURE_DEVOPS_PROJECT', 'Sketchplay');
export const AZURE_DEVOPS_PAT           = optionalEnv('AZURE_DEVOPS_PAT', '');
export const AZURE_DEVOPS_AREA_PATH     = optionalEnv('AZURE_DEVOPS_AREA_PATH', '');
export const AZURE_DEVOPS_ITERATION_PATH = optionalEnv('AZURE_DEVOPS_ITERATION_PATH', '');

/**
 * Returns the base64-encoded Basic auth header value for Azure DevOps REST API.
 * Format: Base64(":{PAT}")
 */
export function getAzureAuthHeader(): string {
  if (!AZURE_DEVOPS_PAT) {
    throw new Error('[env] AZURE_DEVOPS_PAT is not set. Azure DevOps features will not work.');
  }
  return `Basic ${Buffer.from(`:${AZURE_DEVOPS_PAT}`).toString('base64')}`;
}

/**
 * Full REST API base URL for the configured organisation + project.
 */
export function getAzureApiBase(): string {
  return `${AZURE_DEVOPS_ORG_URL}/${AZURE_DEVOPS_PROJECT}/_apis`;
}

// ─── LLM / OpenAI ────────────────────────────────────────────────────────────

export const OPENAI_API_KEY    = optionalEnv('OPENAI_API_KEY', '');
export const OPENAI_MODEL      = optionalEnv('OPENAI_MODEL', 'gpt-4o');
export const OPENAI_MAX_TOKENS = intEnv('OPENAI_MAX_TOKENS', 4096);
export const USE_LLM           = boolEnv('USE_LLM', true);

// ─── Reporting & Artifacts ───────────────────────────────────────────────────

export const ALLURE_RESULTS_DIR = optionalEnv('ALLURE_RESULTS_DIR', 'allure-results');
export const ARTIFACTS_DIR      = optionalEnv('ARTIFACTS_DIR', 'test-artifacts');

export const SCREENSHOTS_DIR = path.resolve(process.cwd(), ARTIFACTS_DIR, 'screenshots');
export const VIDEOS_DIR      = path.resolve(process.cwd(), ARTIFACTS_DIR, 'videos');
export const EXCEL_DIR       = path.resolve(process.cwd(), ARTIFACTS_DIR, 'excel');

// ─── Playwright Runtime ───────────────────────────────────────────────────────

export const HEADLESS  = boolEnv('HEADLESS', true);
export const PW_WORKERS = intEnv('PW_WORKERS', 4);

// ─── Aggregate Config Object ─────────────────────────────────────────────────

/**
 * Single config object for convenience — import this where you need
 * multiple values without cherry-picking individual exports.
 */
export const config = {
  env:      TEST_ENV,
  isCI:     IS_CI,
  headless: HEADLESS,
  workers:  PW_WORKERS,

  urls: {
    web:         WEB_BASE_URL,
    mothership:  MOTHERSHIP_BASE_URL,
  },

  credentials: {
    web: {
      email:    WEB_USER_EMAIL,
      password: WEB_USER_PASSWORD,
    },
    mothership: {
      email:    MOTHERSHIP_USER_EMAIL,
      password: MOTHERSHIP_USER_PASSWORD,
    },
  },

  azure: {
    orgUrl:        AZURE_DEVOPS_ORG_URL,
    project:       AZURE_DEVOPS_PROJECT,
    pat:           AZURE_DEVOPS_PAT,
    areaPath:      AZURE_DEVOPS_AREA_PATH,
    iterationPath: AZURE_DEVOPS_ITERATION_PATH,
    getAuthHeader: getAzureAuthHeader,
    getApiBase:    getAzureApiBase,
  },

  llm: {
    apiKey:    OPENAI_API_KEY,
    model:     OPENAI_MODEL,
    maxTokens: OPENAI_MAX_TOKENS,
    useLLM:    USE_LLM,
  },

  artifacts: {
    allureResultsDir: ALLURE_RESULTS_DIR,
    artifactsDir:     ARTIFACTS_DIR,
    screenshotsDir:   SCREENSHOTS_DIR,
    videosDir:        VIDEOS_DIR,
    excelDir:         EXCEL_DIR,
  },
} as const;

export default config;
