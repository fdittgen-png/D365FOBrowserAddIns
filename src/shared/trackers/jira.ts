import type { Session } from '../types';
import type {
  TrackerProvider,
  ConfigSchema,
  ValidationResult,
  TestResult,
  SubmitResult,
  Attachment,
} from './provider';
import { validateRequired } from './provider';
import {
  buildTicketSubject,
  buildPlainDescription,
  ensureHostPermission,
} from './common';

export interface JiraConfig extends Record<string, unknown> {
  siteUrl: string;
  projectKey: string;
  issueType: string;
  authMode: 'basic' | 'bearer';
  email: string;
  apiToken: string;
  labels: string;
}

const SCHEMA: ConfigSchema = {
  intro:
    'Atlassian Jira uses REST API v3. For Jira Cloud, authenticate with your email and an API token. For Data Center, use a Personal Access Token as a Bearer.',
  docsUrl: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/',
  fields: [
    { key: 'siteUrl', label: 'Site URL', type: 'url', required: true, placeholder: 'https://your-tenant.atlassian.net' },
    { key: 'projectKey', label: 'Project key', type: 'text', required: true, placeholder: 'D365' },
    { key: 'issueType', label: 'Issue type', type: 'text', default: 'Bug', required: true },
    {
      key: 'authMode',
      label: 'Authentication',
      type: 'select',
      default: 'basic',
      options: [
        { value: 'basic', label: 'Email + API token (Cloud)' },
        { value: 'bearer', label: 'Personal Access Token (Data Center)' },
      ],
    },
    { key: 'email', label: 'Email (Cloud only)', type: 'text', placeholder: 'you@example.com' },
    { key: 'apiToken', label: 'API token / PAT', type: 'password', required: true, secret: true },
    { key: 'labels', label: 'Default labels', type: 'text', placeholder: 'd365fo,repro-recorder', hint: 'comma-separated' },
  ],
};

export class JiraProvider implements TrackerProvider<JiraConfig> {
  readonly id = 'jira';
  readonly displayName = 'Atlassian Jira';

  getConfigSchema(): ConfigSchema {
    return SCHEMA;
  }

  validateConfig(config: JiraConfig): ValidationResult {
    const base = validateRequired(SCHEMA, config);
    const errors = { ...(base.errors ?? {}) };
    if (config.authMode === 'basic' && !config.email) errors['email'] = 'Email is required when using basic auth';
    return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
  }

  async testConnection(config: JiraConfig): Promise<TestResult> {
    await ensureHostPermission(config.siteUrl);
    try {
      const resp = await fetch(`${trim(config.siteUrl)}/rest/api/3/myself`, {
        headers: this.authHeaders(config),
      });
      const text = await resp.text();
      if (resp.ok) {
        try {
          const j = JSON.parse(text) as { displayName?: string; emailAddress?: string };
          return { ok: true, message: `Authenticated as ${j.displayName ?? j.emailAddress ?? 'user'}` };
        } catch {
          return { ok: true, message: `HTTP ${resp.status}` };
        }
      }
      return { ok: false, message: `HTTP ${resp.status} — ${truncate(text, 200)}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async submit(session: Session, config: JiraConfig, attachments: Attachment[]): Promise<SubmitResult> {
    await ensureHostPermission(config.siteUrl);
    const labels = (config.labels || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const body = {
      fields: {
        project: { key: config.projectKey },
        issuetype: { name: config.issueType || 'Bug' },
        summary: buildTicketSubject(session),
        description: toAdf(buildPlainDescription(session)),
        labels: labels.length ? labels : undefined,
      },
    };

    const createResp = await fetch(`${trim(config.siteUrl)}/rest/api/3/issue`, {
      method: 'POST',
      headers: { ...this.authHeaders(config), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const createText = await createResp.text();
    if (!createResp.ok) throw new Error(`Jira create failed: HTTP ${createResp.status} — ${truncate(createText, 300)}`);
    const created = JSON.parse(createText) as { id?: string; key?: string };
    if (!created.key) throw new Error('Jira create returned no key');

    // Attach files. On failure, try to roll back by deleting the just-created
    // issue so we never leave half-populated tickets behind.
    try {
      for (const att of attachments) {
        const form = new FormData();
        const blob = new Blob([att.bytes as BlobPart], { type: att.mime });
        form.append('file', blob, att.filename);
        const r = await fetch(`${trim(config.siteUrl)}/rest/api/3/issue/${created.key}/attachments`, {
          method: 'POST',
          headers: { ...this.authHeaders(config), 'X-Atlassian-Token': 'no-check' },
          body: form,
        });
        if (!r.ok) {
          const t = await r.text();
          throw new Error(`attachment ${att.filename} failed: HTTP ${r.status} — ${truncate(t, 200)}`);
        }
      }
    } catch (e) {
      await fetch(`${trim(config.siteUrl)}/rest/api/3/issue/${created.key}`, {
        method: 'DELETE',
        headers: this.authHeaders(config),
      }).catch(() => undefined);
      throw e;
    }

    return {
      ticketId: created.id,
      ticketNumber: created.key,
      ticketUrl: `${trim(config.siteUrl)}/browse/${created.key}`,
      raw: created,
    };
  }

  private authHeaders(config: JiraConfig): Record<string, string> {
    if (config.authMode === 'bearer') {
      return { Authorization: `Bearer ${config.apiToken}` };
    }
    const token = btoa(`${config.email}:${config.apiToken}`);
    return { Authorization: `Basic ${token}` };
  }
}

function trim(u: string): string {
  return u.replace(/\/$/, '');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/**
 * Convert a plain-text block to a minimal Atlassian Document Format tree.
 * Each non-empty line becomes a paragraph; blank lines produce empty
 * paragraphs to preserve spacing.
 */
export function toAdf(plain: string): unknown {
  const paragraphs = plain.split('\n').map((line) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : [],
  }));
  return { type: 'doc', version: 1, content: paragraphs };
}
