// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GithubProvider, buildIssueBody } from '../../src/shared/trackers/github';
import type { Session } from '../../src/shared/types';
import type { Attachment } from '../../src/shared/trackers/provider';

function baseSession(): Session {
  return {
    id: 'ses_gh',
    tabId: 1,
    state: 'stopped',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_060_000,
    title: 'Journal posting fails with invalid account',
    description: 'Happens every time on the voucher form.',
    severity: 'high',
    tags: ['gl', 'posting'],
    environment: {
      url: 'https://usmf.dynamics.com/?cmp=USMF&mi=LedgerJournalTable',
      host: 'usmf.dynamics.com',
      tenant: 'usmf',
      company: 'USMF',
      language: 'en-us',
      userAgent: 'GhAgent/1.0',
      extensionVersion: '0.1.0',
      capturedAt: 0,
    },
    steps: [
      {
        kind: 'navigate',
        id: 's1',
        ts: 1_700_000_001_000,
        url: 'https://usmf.dynamics.com/?cmp=USMF&mi=LedgerJournalTable',
        menuItem: 'LedgerJournalTable',
        formTitle: 'General journal entries',
      },
      {
        kind: 'click',
        id: 's2',
        ts: 1_700_000_002_000,
        label: 'New',
        role: 'button',
        formTitle: 'General journal entries',
      },
      { kind: 'edit', id: 's3', ts: 1_700_000_003_000, fieldLabel: 'Journal name', oldValue: '', newValue: 'GenJrn' },
      { kind: 'error', id: 's4', ts: 1_700_000_004_000, message: 'Account X is not valid for posting.' },
    ],
  };
}

const cfg = {
  apiUrl: 'https://api.github.com',
  owner: 'acme',
  repo: 'd365fo-bugs',
  token: 'ghp_faketokenvalue123',
  labels: 'bug,d365fo',
  assignees: 'alice,bob',
  timeoutMs: 30000,
};

function xmlAttachment(bytes = 64): Attachment {
  return {
    filename: 'repro.xml',
    mime: 'application/xml; charset=utf-8',
    bytes: new TextEncoder().encode('<r>'.repeat(bytes).slice(0, bytes)),
  };
}

function pngAttachment(name: string, sizeBytes: number): Attachment {
  return {
    filename: name,
    mime: 'image/png',
    bytes: new Uint8Array(sizeBytes).fill(0x42),
  };
}

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

describe('GithubProvider — validateConfig', () => {
  const provider = new GithubProvider();

  it('accepts a full config', () => {
    expect(provider.validateConfig(cfg).ok).toBe(true);
  });

  it('rejects when apiUrl is missing', () => {
    expect(provider.validateConfig({ ...cfg, apiUrl: '' }).ok).toBe(false);
  });

  it('rejects when owner is missing', () => {
    expect(provider.validateConfig({ ...cfg, owner: '' }).ok).toBe(false);
  });

  it('rejects when repo is missing', () => {
    expect(provider.validateConfig({ ...cfg, repo: '' }).ok).toBe(false);
  });

  it('rejects when token is missing', () => {
    expect(provider.validateConfig({ ...cfg, token: '' }).ok).toBe(false);
  });
});

describe('GithubProvider — testConnection', () => {
  const provider = new GithubProvider();

  it('hits /user with the bearer token and returns the login on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ login: 'alice' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await provider.testConnection(cfg);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/alice/);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/user');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ghp_faketokenvalue123');
  });

  it('reports failure on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad credentials', { status: 401 })));
    const r = await provider.testConnection(cfg);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('401');
  });
});

describe('GithubProvider — submit', () => {
  const provider = new GithubProvider();

  it('POSTs to /repos/{owner}/{repo}/issues with correct payload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ id: 4242, number: 17, html_url: 'https://github.com/acme/d365fo-bugs/issues/17' }),
          { status: 201 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.submit(baseSession(), cfg, [xmlAttachment()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/acme/d365fo-bugs/issues');
    expect((init as RequestInit).method).toBe('POST');

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.title).toContain('Journal posting fails');
    expect(body.title).toContain('[USMF]');
    expect(body.labels).toEqual(['bug', 'd365fo']);
    expect(body.assignees).toEqual(['alice', 'bob']);
    expect(body.body).toContain('**Severity:** high');
    expect(body.body).toContain('## Steps to reproduce');

    expect(result.ticketNumber).toBe('#17');
    expect(result.ticketId).toBe('4242');
    expect(result.ticketUrl).toBe('https://github.com/acme/d365fo-bugs/issues/17');
  });

  it('omits labels and assignees when config has none', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 1, number: 2, html_url: 'https://x/2' }), { status: 201 }),
        ),
    );
    await provider.submit(baseSession(), { ...cfg, labels: '', assignees: '' }, [xmlAttachment()]);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body.labels).toBeUndefined();
    expect(body.assignees).toBeUndefined();
  });

  it('embeds inline data-URI images when total size is under the budget', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 1, number: 2, html_url: 'https://x/2' }), { status: 201 }),
        ),
    );
    const attachments: Attachment[] = [
      xmlAttachment(),
      pngAttachment('step-001.png', 1024),
      pngAttachment('step-002.png', 1024),
    ];
    await provider.submit(baseSession(), cfg, attachments);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string) as { body: string };
    expect(body.body).toContain('![step-001.png](data:image/png;base64,');
    expect(body.body).toContain('![step-002.png](data:image/png;base64,');
  });

  it('drops inline images and points at the .zip export when total size exceeds the 50KB budget', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 1, number: 2, html_url: 'https://x/2' }), { status: 201 }),
        ),
    );
    const attachments: Attachment[] = [
      xmlAttachment(),
      pngAttachment('big-1.png', 30 * 1024),
      pngAttachment('big-2.png', 30 * 1024),
    ];
    await provider.submit(baseSession(), cfg, attachments);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string) as { body: string };
    expect(body.body).not.toContain('data:image/png;base64,');
    expect(body.body).toMatch(/too large to inline/);
    expect(body.body).toMatch(/XML bundle/);
  });

  it('error path: 422 response is surfaced through sanitizeTrackerError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: 'Validation Failed',
            errors: [{ Authorization: 'Bearer ghp_leaky', field: 'labels' }],
          }),
          { status: 422 },
        ),
      ),
    );
    await expect(provider.submit(baseSession(), cfg, [xmlAttachment()])).rejects.toThrow(/GitHub returned 422/);
    // Error message must not include the bearer token verbatim
    await provider.submit(baseSession(), cfg, [xmlAttachment()]).catch((e: Error) => {
      expect(e.message).not.toContain('ghp_leaky');
    });
  });

  it('passes Content-Type and Accept headers for GitHub REST API', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 1, number: 2, html_url: 'https://x/2' }), { status: 201 }),
        ),
    );
    await provider.submit(baseSession(), cfg, [xmlAttachment()]);
    const headers = (vi.mocked(fetch).mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Accept']).toBe('application/vnd.github+json');
    expect(headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });
});

describe('GithubProvider — buildIssueBody', () => {
  it('includes the structured repro.xml as a fenced code block', () => {
    const body = buildIssueBody(baseSession(), [xmlAttachment()]);
    expect(body).toContain('## Structured report');
    expect(body).toContain('```xml');
  });

  it('escapes nothing: markdown passes through', () => {
    // GitHub renders markdown as-is; we rely on fenced blocks and the API
    // for escaping. Sanity check that a title with backticks still flows.
    const s = baseSession();
    s.title = 'Issue with ` backticks';
    const body = buildIssueBody(s, [xmlAttachment()]);
    expect(body).toContain('Steps to reproduce');
  });

  it('renders zero-step sessions without crashing', () => {
    const s = baseSession();
    s.steps = [];
    const body = buildIssueBody(s, [xmlAttachment()]);
    expect(body).toContain('## Steps to reproduce');
  });
});
