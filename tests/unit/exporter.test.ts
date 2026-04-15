// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import AdmZip from 'adm-zip';
import { buildReproXml, exportSessionAsZip } from '@shared/exporter';
import type { Session, SnapshotBlob } from '@shared/types';
import { putSnapshot } from '@shared/storage';

function sampleSession(): Session {
  return {
    id: 'ses_abc',
    tabId: 1,
    state: 'stopped',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_060_000,
    title: 'GL posting fails with invalid account',
    description: 'Posting a journal voucher raises an error.',
    severity: 'high',
    tags: ['gl', 'posting'],
    environment: {
      url: 'https://usmf.dynamics.com/?cmp=USMF&mi=LedgerJournalTable',
      host: 'usmf.dynamics.com',
      tenant: 'usmf',
      company: 'USMF',
      legalEntity: 'USMF',
      language: 'en-us',
      userAgent: 'Mozilla/5.0 test',
      extensionVersion: '0.1.0',
      capturedAt: 1_700_000_000_000,
    },
    steps: [
      {
        kind: 'navigate',
        id: 'st1',
        ts: 1_700_000_001_000,
        url: 'https://usmf.dynamics.com/?cmp=USMF&mi=LedgerJournalTable',
        menuItem: 'LedgerJournalTable',
        company: 'USMF',
        formTitle: 'General journal entries',
        screenshotId: 'img1',
      },
      {
        kind: 'click',
        id: 'st2',
        ts: 1_700_000_002_000,
        label: 'New',
        role: 'button',
        formTitle: 'General journal entries',
      },
      {
        kind: 'edit',
        id: 'st3',
        ts: 1_700_000_003_000,
        fieldLabel: 'Journal name',
        oldValue: '',
        newValue: 'GenJrn',
        formTitle: 'Journal voucher',
      },
      {
        kind: 'error',
        id: 'st4',
        ts: 1_700_000_004_000,
        message: 'Account X is not valid for posting to journal GenJrn.',
        formTitle: 'Journal voucher',
        screenshotId: 'img2',
      },
      {
        kind: 'note',
        id: 'st5',
        ts: 1_700_000_005_000,
        text: 'This is reproducible on every posting attempt.',
      },
      {
        kind: 'pasted-img',
        id: 'st6',
        ts: 1_700_000_006_000,
        screenshotId: 'imgP',
        note: 'zoomed error detail',
      },
    ],
  };
}

describe('buildReproXml', () => {
  it('produces a stable XML document with expected structure', () => {
    const session = sampleSession();
    const attachments = new Map<string, string>([
      ['img1', 'screenshots/step-001.png'],
      ['img2', 'screenshots/step-004.png'],
      ['imgP', 'screenshots/pasted-01.png'],
    ]);
    const xml = buildReproXml(session, attachments);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('sessionId="ses_abc"');
    expect(xml).toContain('<title>GL posting fails with invalid account</title>');
    expect(xml).toContain('<severity>high</severity>');
    expect(xml).toContain('<tag>gl</tag>');
    expect(xml).toContain('<company>USMF</company>');
    expect(xml).toContain('<menuItem>LedgerJournalTable</menuItem>');
    expect(xml).toContain('<fieldLabel>Journal name</fieldLabel>');
    expect(xml).toContain('<oldValue />');
    expect(xml).toContain('<newValue>GenJrn</newValue>');
    expect(xml).toContain('<attachment href="screenshots/step-001.png" type="image/png" />');
    expect(xml).toContain('<attachment href="screenshots/pasted-01.png" type="image/png" />');
    expect(xml).toContain('<text>This is reproducible on every posting attempt.</text>');
  });

  it('escapes special XML characters', () => {
    const session = sampleSession();
    session.title = 'Error <foo> & "bar" \'baz\'';
    const xml = buildReproXml(session, new Map());
    expect(xml).toContain('<title>Error &lt;foo&gt; &amp; &quot;bar&quot; &apos;baz&apos;</title>');
  });

  it('numbers each step sequentially', () => {
    const session = sampleSession();
    const xml = buildReproXml(session, new Map());
    const matches = xml.match(/<step[^>]*index="(\d+)"/g);
    expect(matches).toHaveLength(session.steps.length);
    for (let i = 0; i < session.steps.length; i++) {
      expect(matches![i]).toContain(`index="${i + 1}"`);
    }
  });
});

describe('exportSessionAsZip', () => {
  beforeEach(() => {
    // createObjectURL isn't provided by jsdom; stub it so the exporter can build a URL
    (globalThis.URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi
      .fn()
      .mockImplementation((_b: Blob) => 'blob:mock-url');
  });

  it('bundles XML, metadata, and snapshots into a valid zip', async () => {
    const session = sampleSession();
    // register the snapshot referenced by navigate step
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const blob = new Blob([png], { type: 'image/png' });
    const snap: SnapshotBlob = {
      id: 'img1',
      sessionId: session.id,
      ts: Date.now(),
      mime: 'image/png',
      data: blob,
    };
    await putSnapshot(snap);
    const snap2: SnapshotBlob = { ...snap, id: 'img2' };
    await putSnapshot(snap2);
    const snapP: SnapshotBlob = { ...snap, id: 'imgP' };
    await putSnapshot(snapP);

    const captured: { blob: Blob | null } = { blob: null };
    (globalThis.URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => {
      captured.blob = b;
      return 'blob:mock-url';
    };

    const out = await exportSessionAsZip(session);
    expect(out.url).toBe('blob:mock-url');
    expect(out.filename).toMatch(/^d365fo-repro-\d{8}-\d{4}-gl-posting-fails-with-invalid-account\.zip$/);

    expect(captured.blob).not.toBeNull();
    const buf = Buffer.from(await captured.blob!.arrayBuffer());
    const zip = new AdmZip(buf);
    const entries = zip.getEntries().map((e) => e.entryName);
    expect(entries).toContain('repro.xml');
    expect(entries).toContain('metadata.json');
    expect(entries).toContain('screenshots/step-001.png');
    expect(entries).toContain('screenshots/step-004.png');
    expect(entries).toContain('screenshots/pasted-01.png');

    const xml = zip.getEntry('repro.xml')!.getData().toString('utf8');
    expect(xml).toContain('<title>GL posting fails with invalid account</title>');
    const meta = JSON.parse(zip.getEntry('metadata.json')!.getData().toString('utf8'));
    expect(meta.id).toBe('ses_abc');
    expect(meta.steps).toHaveLength(session.steps.length);
  });
});
