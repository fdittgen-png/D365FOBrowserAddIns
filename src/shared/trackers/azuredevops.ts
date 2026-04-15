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

export interface AzureDevOpsConfig extends Record<string, unknown> {
  organizationUrl: string;
  project: string;
  workItemType: string;
  areaPath: string;
  iterationPath: string;
  pat: string;
  apiVersion: string;
}

const SCHEMA: ConfigSchema = {
  intro:
    'Azure DevOps uses the Work Items REST API. Authentication uses a Personal Access Token with "Work Items (Read & Write)" scope.',
  docsUrl: 'https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/work-items',
  fields: [
    { key: 'organizationUrl', label: 'Organization URL', type: 'url', required: true, placeholder: 'https://dev.azure.com/contoso' },
    { key: 'project', label: 'Project', type: 'text', required: true },
    { key: 'workItemType', label: 'Work item type', type: 'text', default: 'Bug', required: true },
    { key: 'areaPath', label: 'Area path', type: 'text', hint: 'optional' },
    { key: 'iterationPath', label: 'Iteration path', type: 'text', hint: 'optional' },
    { key: 'pat', label: 'Personal Access Token', type: 'password', required: true, secret: true },
    { key: 'apiVersion', label: 'API version', type: 'text', default: '7.1' },
  ],
};

const SEVERITY_MAP: Record<string, string> = {
  high: '1 - Critical',
  med: '3 - Medium',
  low: '4 - Low',
};

export class AzureDevOpsProvider implements TrackerProvider<AzureDevOpsConfig> {
  readonly id = 'azuredevops';
  readonly displayName = 'Azure DevOps';

  getConfigSchema(): ConfigSchema {
    return SCHEMA;
  }

  validateConfig(config: AzureDevOpsConfig): ValidationResult {
    return validateRequired(SCHEMA, config);
  }

  async testConnection(config: AzureDevOpsConfig): Promise<TestResult> {
    await ensureHostPermission(config.organizationUrl);
    try {
      const url = `${trim(config.organizationUrl)}/${encodeURIComponent(config.project)}/_apis/wit/workitemtypes?api-version=${config.apiVersion}`;
      const resp = await fetch(url, { headers: this.authHeaders(config) });
      const text = await resp.text();
      if (resp.ok) {
        try {
          const j = JSON.parse(text) as { count?: number };
          return { ok: true, message: `Reached project. ${j.count ?? '?'} work item types available.` };
        } catch {
          return { ok: true, message: `HTTP ${resp.status}` };
        }
      }
      return { ok: false, message: `HTTP ${resp.status} — ${truncate(text, 200)}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async submit(session: Session, config: AzureDevOpsConfig, attachments: Attachment[]): Promise<SubmitResult> {
    await ensureHostPermission(config.organizationUrl);
    const apiVersion = config.apiVersion || '7.1';
    const headers = this.authHeaders(config);

    // 1. Upload attachments first so the work-item create can reference them.
    const uploaded: { url: string; name: string }[] = [];
    for (const att of attachments) {
      const uploadUrl = `${trim(config.organizationUrl)}/${encodeURIComponent(config.project)}/_apis/wit/attachments?fileName=${encodeURIComponent(att.filename)}&api-version=${apiVersion}`;
      const resp = await fetch(uploadUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': att.mime || 'application/octet-stream' },
        body: att.bytes as BodyInit,
      });
      const text = await resp.text();
      if (!resp.ok) throw new Error(`Attachment upload failed for ${att.filename}: HTTP ${resp.status} — ${truncate(text, 200)}`);
      const parsed = JSON.parse(text) as { url?: string };
      if (!parsed.url) throw new Error(`Attachment upload returned no url for ${att.filename}`);
      uploaded.push({ url: parsed.url, name: att.filename });
    }

    // 2. Build the JSON Patch document for work item creation.
    const ops: Array<{ op: 'add'; path: string; value: unknown }> = [
      { op: 'add', path: '/fields/System.Title', value: buildTicketSubject(session) },
      {
        op: 'add',
        path: '/fields/System.Description',
        value: escapeHtml(buildPlainDescription(session)).replace(/\n/g, '<br/>'),
      },
      {
        op: 'add',
        path: '/fields/Microsoft.VSTS.Common.Severity',
        value: SEVERITY_MAP[session.severity] ?? '3 - Medium',
      },
    ];
    if (config.areaPath) ops.push({ op: 'add', path: '/fields/System.AreaPath', value: config.areaPath });
    if (config.iterationPath) ops.push({ op: 'add', path: '/fields/System.IterationPath', value: config.iterationPath });
    for (const u of uploaded) {
      ops.push({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'AttachedFile',
          url: u.url,
          attributes: { comment: u.name },
        },
      });
    }
    if (session.tags.length) {
      ops.push({ op: 'add', path: '/fields/System.Tags', value: session.tags.join('; ') });
    }

    const createUrl = `${trim(config.organizationUrl)}/${encodeURIComponent(config.project)}/_apis/wit/workitems/$${encodeURIComponent(config.workItemType || 'Bug')}?api-version=${apiVersion}`;
    const resp = await fetch(createUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json-patch+json' },
      body: JSON.stringify(ops),
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`Azure DevOps create failed: HTTP ${resp.status} — ${truncate(text, 300)}`);
    const parsed = JSON.parse(text) as { id?: number; _links?: { html?: { href?: string } } };
    return {
      ticketId: parsed.id != null ? String(parsed.id) : undefined,
      ticketNumber: parsed.id != null ? String(parsed.id) : undefined,
      ticketUrl: parsed._links?.html?.href,
      raw: parsed,
    };
  }

  private authHeaders(config: AzureDevOpsConfig): Record<string, string> {
    return { Authorization: `Basic ${btoa(`:${config.pat}`)}` };
  }
}

function trim(u: string): string {
  return u.replace(/\/$/, '');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
