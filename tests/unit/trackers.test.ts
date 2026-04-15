// @vitest-environment node
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OtrsProvider } from '../../src/shared/trackers/otrs';
import { JiraProvider, toAdf } from '../../src/shared/trackers/jira';
import { AzureDevOpsProvider } from '../../src/shared/trackers/azuredevops';
import { TRACKER_PROVIDERS, getProvider, applyDefaults } from '../../src/shared/trackers';
import type { Session } from '../../src/shared/types';
import type { Attachment } from '../../src/shared/trackers/provider';

function baseSession(): Session {
  return {
    id: 'ses_test',
    tabId: 1,
    state: 'stopped',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_060_000,
    title: 'Journal posting fails',
    description: 'Error when posting journal.',
    severity: 'high',
    tags: ['gl'],
    environment: {
      url: 'https://usmf.dynamics.com/?cmp=USMF&mi=LedgerJournalTable',
      host: 'usmf.dynamics.com',
      tenant: 'usmf',
      company: 'USMF',
      language: 'en-us',
      userAgent: 'test',
      extensionVersion: '0.1.0',
      capturedAt: 1_700_000_000_000,
    },
    steps: [
      {
        kind: 'navigate',
        id: 's1',
        ts: 1_700_000_001_000,
        url: 'https://usmf.dynamics.com/?cmp=USMF&mi=LedgerJournalTable',
        menuItem: 'LedgerJournalTable',
        company: 'USMF',
        formTitle: 'General journal entries',
      },
      { kind: 'error', id: 's2', ts: 1_700_000_002_000, message: 'Account invalid' },
    ],
  };
}

function xmlAttachment(): Attachment[] {
  return [
    { filename: 'repro.xml', mime: 'application/xml; charset=utf-8', bytes: new TextEncoder().encode('<r/>') },
    { filename: 'step-001.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
  ];
}

// Minimal chrome.permissions stub to keep ensureHostPermission happy.
beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    permissions: {
      contains: vi.fn().mockResolvedValue(true),
      request: vi.fn().mockResolvedValue(true),
    },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('registry', () => {
  it('exposes all three providers with unique ids', () => {
    const ids = TRACKER_PROVIDERS.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['otrs', 'jira', 'azuredevops']));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('getProvider returns the matching provider', () => {
    expect(getProvider('otrs')?.id).toBe('otrs');
    expect(getProvider('missing')).toBeUndefined();
  });
});

describe('applyDefaults', () => {
  it('fills missing keys from schema defaults and leaves provided keys alone', () => {
    const provider = new OtrsProvider();
    const filled = applyDefaults(provider.getConfigSchema(), { baseUrl: 'https://host' });
    expect(filled.baseUrl).toBe('https://host');
    expect(filled.type).toBe('Incident');
    expect(filled.priority).toBe('3 normal');
    expect(filled.state).toBe('new');
  });
});

describe('OtrsProvider', () => {
  const provider = new OtrsProvider();

  const fullConfig = {
    baseUrl: 'https://otrs.example.com',
    webservice: 'GenericTicketConnectorREST',
    user: 'agent',
    password: 'secret',
    queue: 'Support::D365FO',
    type: 'Incident',
    priority: '3 normal',
    state: 'new',
  };

  it('validates required fields', () => {
    expect(provider.validateConfig({ ...fullConfig, baseUrl: '' }).ok).toBe(false);
    expect(provider.validateConfig(fullConfig).ok).toBe(true);
  });

  it('submit posts a TicketCreate with base64 attachments and returns the ticket id/url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ TicketID: '42', TicketNumber: '2026042500042' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await provider.submit(baseSession(), fullConfig, xmlAttachment());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/otrs/nph-genericinterface.pl/Webservice/GenericTicketConnectorREST/Ticket');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.UserLogin).toBe('agent');
    expect(body.Ticket.Queue).toBe('Support::D365FO');
    expect(body.Attachment).toHaveLength(2);
    expect(body.Attachment[0].Filename).toBe('repro.xml');
    expect(typeof body.Attachment[0].Content).toBe('string');
    expect(result.ticketNumber).toBe('2026042500042');
    expect(result.ticketUrl).toContain('AgentTicketZoom;TicketID=42');
  });

  it('surfaces OTRS error envelopes as thrown errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ Error: { ErrorCode: 'TicketCreate.AuthFail', ErrorMessage: 'invalid user' } }), {
          status: 200,
        }),
      ),
    );
    await expect(provider.submit(baseSession(), fullConfig, xmlAttachment())).rejects.toThrow(/AuthFail/);
  });

  it('testConnection reports non-200 as failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })),
    );
    const r = await provider.testConnection(fullConfig);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('401');
  });
});

describe('JiraProvider', () => {
  const provider = new JiraProvider();
  const cfg = {
    siteUrl: 'https://acme.atlassian.net',
    projectKey: 'D365',
    issueType: 'Bug',
    authMode: 'basic' as const,
    email: 'me@acme.com',
    apiToken: 'token',
    labels: 'd365fo,repro',
  };

  it('validateConfig requires email for basic auth', () => {
    expect(provider.validateConfig({ ...cfg, email: '' }).ok).toBe(false);
    expect(provider.validateConfig(cfg).ok).toBe(true);
  });

  it('toAdf produces one paragraph per line including blanks', () => {
    const doc = toAdf('hello\n\nworld') as { content: unknown[] };
    expect(doc.content).toHaveLength(3);
  });

  it('submit creates issue, uploads attachments, and returns key/url', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '10001', key: 'D365-42' }), { status: 201 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await provider.submit(baseSession(), cfg, xmlAttachment());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [createUrl, createInit] = fetchMock.mock.calls[0]!;
    expect(createUrl).toContain('/rest/api/3/issue');
    const body = JSON.parse((createInit as RequestInit).body as string);
    expect(body.fields.project.key).toBe('D365');
    expect(body.fields.labels).toEqual(['d365fo', 'repro']);
    // Attachment request uses FormData
    const [attachUrl] = fetchMock.mock.calls[1]!;
    expect(attachUrl).toContain('/rest/api/3/issue/D365-42/attachments');
    expect(r.ticketNumber).toBe('D365-42');
    expect(r.ticketUrl).toBe('https://acme.atlassian.net/browse/D365-42');
  });

  it('rolls back the issue when an attachment upload fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '1', key: 'D365-99' }), { status: 201 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(provider.submit(baseSession(), cfg, xmlAttachment())).rejects.toThrow(/attachment/);
    // The 3rd call must be a DELETE to roll back
    const last = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!;
    expect((last[1] as RequestInit).method).toBe('DELETE');
    expect(last[0]).toContain('/rest/api/3/issue/D365-99');
  });

  it('sends Bearer header when authMode=bearer', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: '2', key: 'D365-1' }), { status: 201 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await provider.submit(baseSession(), { ...cfg, authMode: 'bearer' }, xmlAttachment());
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token');
  });
});

describe('AzureDevOpsProvider', () => {
  const provider = new AzureDevOpsProvider();
  const cfg = {
    organizationUrl: 'https://dev.azure.com/contoso',
    project: 'Finance',
    workItemType: 'Bug',
    areaPath: 'Finance\\GL',
    iterationPath: 'Finance\\Sprint 42',
    pat: 'pat-token',
    apiVersion: '7.1',
  };

  it('validateConfig enforces required fields', () => {
    expect(provider.validateConfig({ ...cfg, pat: '' }).ok).toBe(false);
    expect(provider.validateConfig(cfg).ok).toBe(true);
  });

  it('submit uploads attachments then creates the work item with JSON Patch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'att-1', url: 'https://attach/1' }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'att-2', url: 'https://attach/2' }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 1234,
            _links: { html: { href: 'https://dev.azure.com/contoso/Finance/_workitems/edit/1234' } },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const r = await provider.submit(baseSession(), cfg, xmlAttachment());
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const attachCall = fetchMock.mock.calls[0]!;
    expect(attachCall[0]).toContain('/_apis/wit/attachments?fileName=repro.xml');

    const createCall = fetchMock.mock.calls[2]!;
    expect(createCall[0]).toContain('/_apis/wit/workitems/$Bug');
    const body = JSON.parse((createCall[1] as RequestInit).body as string) as Array<{ path: string; value: unknown }>;
    const paths = body.map((op) => op.path);
    expect(paths).toContain('/fields/System.Title');
    expect(paths).toContain('/fields/Microsoft.VSTS.Common.Severity');
    expect(paths).toContain('/fields/System.AreaPath');
    expect(paths.filter((p) => p === '/relations/-')).toHaveLength(2);
    expect(r.ticketUrl).toContain('_workitems/edit/1234');
    expect(r.ticketId).toBe('1234');
  });
});
