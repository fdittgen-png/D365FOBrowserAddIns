import type { Session } from '../types';
import type { TrackerProvider, ConfigSchema, ValidationResult, TestResult, SubmitResult, Attachment } from './provider';
import { validateRequired } from './provider';
import {
  buildTicketSubject,
  ensureHostPermission,
  fetchWithTimeout,
  resolveTimeout,
  sanitizeTrackerError,
  bytesToBase64,
} from './common';

export interface GithubConfig extends Record<string, unknown> {
  apiUrl: string;
  owner: string;
  repo: string;
  token: string;
  labels: string;
  assignees: string;
  timeoutMs?: number;
}

const SCHEMA: ConfigSchema = {
  intro:
    'Create a GitHub issue on a configured repository. For GitHub.com use the default API URL; for GitHub Enterprise point at your instance.',
  docsUrl: 'https://docs.github.com/en/rest/issues/issues#create-an-issue',
  fields: [
    { key: 'apiUrl', label: 'API base URL', type: 'url', required: true, default: 'https://api.github.com' },
    { key: 'owner', label: 'Repository owner', type: 'text', required: true, placeholder: 'your-org' },
    { key: 'repo', label: 'Repository name', type: 'text', required: true, placeholder: 'd365fo-bugs' },
    {
      key: 'token',
      label: 'Personal access token',
      type: 'password',
      required: true,
      secret: true,
      hint: 'Classic PAT with `repo` scope or fine-grained token with Issues: write',
    },
    { key: 'labels', label: 'Default labels', type: 'text', placeholder: 'bug,d365fo', hint: 'comma-separated' },
    {
      key: 'assignees',
      label: 'Default assignees',
      type: 'text',
      placeholder: 'alice,bob',
      hint: 'comma-separated usernames',
    },
    {
      key: 'timeoutMs',
      label: 'Request timeout (ms)',
      type: 'number',
      default: 30000,
      hint: 'Default 30s. Capped at 120s.',
    },
  ],
};

/** Soft cap for inline-image payload. GitHub markdown truncates very long comments. */
const INLINE_IMAGE_BUDGET_BYTES = 50 * 1024;

export class GithubProvider implements TrackerProvider<GithubConfig> {
  readonly id = 'github';
  readonly displayName = 'GitHub Issues';

  getConfigSchema(): ConfigSchema {
    return SCHEMA;
  }

  validateConfig(config: GithubConfig): ValidationResult {
    return validateRequired(SCHEMA, config);
  }

  async testConnection(config: GithubConfig): Promise<TestResult> {
    await ensureHostPermission(config.apiUrl);
    try {
      const resp = await fetchWithTimeout(
        `${trim(config.apiUrl)}/user`,
        { headers: this.authHeaders(config) },
        resolveTimeout(config),
      );
      const text = await resp.text();
      if (resp.ok) {
        try {
          const j = JSON.parse(text) as { login?: string };
          return { ok: true, message: `Authenticated as ${j.login ?? 'user'}` };
        } catch {
          return { ok: true, message: `HTTP ${resp.status}` };
        }
      }
      return { ok: false, message: `HTTP ${resp.status} — ${sanitizeTrackerError(text, 200)}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async submit(session: Session, config: GithubConfig, attachments: Attachment[]): Promise<SubmitResult> {
    await ensureHostPermission(config.apiUrl);
    const labels = parseList(config.labels);
    const assignees = parseList(config.assignees);

    const body = buildIssueBody(session, attachments);
    const payload: Record<string, unknown> = {
      title: buildTicketSubject(session, 'D365FO issue'),
      body,
    };
    if (labels.length) payload.labels = labels;
    if (assignees.length) payload.assignees = assignees;

    const resp = await fetchWithTimeout(
      `${trim(config.apiUrl)}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/issues`,
      {
        method: 'POST',
        headers: {
          ...this.authHeaders(config),
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
        },
        body: JSON.stringify(payload),
      },
      resolveTimeout(config),
    );
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`GitHub returned ${resp.status}: ${sanitizeTrackerError(text, 300)}`);
    }
    const created = JSON.parse(text) as { number?: number; id?: number; html_url?: string };
    return {
      ticketId: created.id != null ? String(created.id) : undefined,
      ticketNumber: created.number != null ? `#${created.number}` : undefined,
      ticketUrl: created.html_url,
      raw: created,
    };
  }

  private authHeaders(config: GithubConfig): Record<string, string> {
    return {
      Authorization: `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}

function trim(u: string): string {
  return u.replace(/\/$/, '');
}

function parseList(csv: string): string[] {
  return (csv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Render the issue body as markdown with metadata, steps, and inline data-URI
 * images for every screenshot — as long as the combined image payload stays
 * under INLINE_IMAGE_BUDGET_BYTES. When the budget is exceeded, images are
 * dropped and a note points the reader at the .zip export.
 *
 * The full repro.xml content is appended at the bottom as a fenced code
 * block so developers can parse the structured report without the zip.
 */
export function buildIssueBody(session: Session, attachments: Attachment[]): string {
  const images = attachments.filter((a) => a.mime.startsWith('image/'));
  const xmlAttachment = attachments.find((a) => a.filename === 'repro.xml');

  const totalImageBytes = images.reduce((n, a) => n + a.bytes.length, 0);
  const embedImages = totalImageBytes <= INLINE_IMAGE_BUDGET_BYTES;

  const lines: string[] = [];
  lines.push(`**Severity:** ${session.severity}${session.tags.length ? `  **Tags:** ${session.tags.join(', ')}` : ''}`);
  lines.push('');
  lines.push('## Environment');
  const e = session.environment;
  if (e.host) lines.push(`- **Host:** ${e.host}`);
  if (e.company) lines.push(`- **Company:** ${e.company}`);
  if (e.tenant) lines.push(`- **Tenant:** ${e.tenant}`);
  if (e.language) lines.push(`- **Language:** ${e.language}`);
  if (e.url) lines.push(`- **URL:** ${e.url}`);
  lines.push(`- **Extension:** ${e.extensionVersion}`);
  lines.push('');
  if (session.description) {
    lines.push('## Description');
    lines.push(session.description);
    lines.push('');
  }
  lines.push('## Steps to reproduce');
  session.steps.forEach((s, i) => {
    const idx = i + 1;
    switch (s.kind) {
      case 'navigate':
        lines.push(`${idx}. **[NAV]** ${s.formTitle ?? s.menuItem ?? s.url}`);
        break;
      case 'click':
        lines.push(`${idx}. **[CLICK]** ${s.label}${s.formTitle ? ` *(${s.formTitle})*` : ''}`);
        break;
      case 'edit':
        lines.push(`${idx}. **[EDIT]** ${s.fieldLabel}: \`${s.oldValue}\` → \`${s.newValue}\``);
        break;
      case 'error':
        lines.push(`${idx}. **[ERROR]** ${s.message}`);
        break;
      case 'manual-snap':
        lines.push(`${idx}. **[SNAP]** ${s.note ?? '(manual snapshot)'}`);
        break;
      case 'note':
        lines.push(`${idx}. **[NOTE]** ${s.text}`);
        break;
      case 'pasted-img':
        lines.push(`${idx}. **[IMG]** ${s.note ?? '(pasted image)'}`);
        break;
    }
  });
  lines.push('');

  if (images.length > 0) {
    lines.push('## Screenshots');
    if (embedImages) {
      for (const img of images) {
        const b64 = bytesToBase64(img.bytes);
        lines.push(`![${img.filename}](data:${img.mime};base64,${b64})`);
      }
    } else {
      lines.push(
        `_${images.length} screenshots totaling ${Math.round(totalImageBytes / 1024)} KB — too large to inline. Export the session as an XML bundle and attach the zip._`,
      );
    }
    lines.push('');
  }

  if (xmlAttachment) {
    lines.push('## Structured report (repro.xml)');
    lines.push('```xml');
    lines.push(new TextDecoder().decode(xmlAttachment.bytes));
    lines.push('```');
  }

  return lines.join('\n');
}
