// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import AdmZip from 'adm-zip';
import {
  buildDocx,
  buildDocumentXml,
  buildContentTypesXml,
  buildRootRels,
  buildDocumentRels,
  pngDimensions,
  computeImageEmu,
  exportSessionAsDocx,
} from '../../src/shared/docx';
import type { Session, SnapshotBlob } from '../../src/shared/types';
import { putSnapshot } from '../../src/shared/storage';

// ---------------------------------------------------------------- fixtures

function sampleSession(): Session {
  return {
    id: 'ses_docx',
    tabId: 1,
    state: 'stopped',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_060_000,
    title: 'GL posting fails with <bad> chars & "quotes"',
    description: 'Deterministic fixture for DOCX tests.',
    severity: 'high',
    tags: ['gl', 'posting'],
    environment: {
      url: 'https://usmf.dynamics.com/?cmp=USMF&mi=LedgerJournalTable',
      host: 'usmf.dynamics.com',
      tenant: 'usmf',
      company: 'USMF',
      language: 'en-us',
      userAgent: 'DocxAgent/1.0',
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
        screenshotId: 'img_1',
      },
      {
        kind: 'click',
        id: 's2',
        ts: 1_700_000_002_000,
        label: 'Post',
        role: 'button',
        formTitle: 'General journal entries',
      },
      {
        kind: 'edit',
        id: 's3',
        ts: 1_700_000_003_000,
        fieldLabel: 'Journal name',
        oldValue: '',
        newValue: 'GenJrn',
      },
      {
        kind: 'error',
        id: 's4',
        ts: 1_700_000_004_000,
        message: 'Account X is not valid for posting.',
        screenshotId: 'img_2',
      },
    ],
  };
}

/** Minimal but valid 1x1 PNG (89 50 4e 47 + rest). */
function tinyPng(): Uint8Array {
  // prettier-ignore
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x5b, 0xb3, 0x91,
    0xe4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
}

// ---------------------------------------------------------------- pure helpers

describe('pngDimensions', () => {
  it('parses a real PNG IHDR chunk', () => {
    expect(pngDimensions(tinyPng())).toEqual({ width: 1, height: 1 });
  });

  it('returns null for bytes that are not a PNG', () => {
    expect(pngDimensions(new Uint8Array([0, 1, 2, 3]))).toBeNull();
    expect(pngDimensions(new TextEncoder().encode('not a png but long enough..........'))).toBeNull();
  });
});

describe('computeImageEmu', () => {
  it('scales pixel dimensions to EMU using 96 DPI', () => {
    expect(computeImageEmu(96, 96)).toEqual({ widthEmu: 914400, heightEmu: 914400 });
  });

  it('clamps width to 6 inches while preserving aspect ratio', () => {
    const r = computeImageEmu(1200, 600);
    expect(r.widthEmu).toBe(6 * 914400);
    // original aspect 2:1 → height half of width
    expect(r.heightEmu).toBe(3 * 914400);
  });

  it('returns a fallback when dimensions are zero', () => {
    const r = computeImageEmu(0, 0);
    expect(r.widthEmu).toBeGreaterThan(0);
    expect(r.heightEmu).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- XML parts

describe('buildContentTypesXml', () => {
  it('declares the mandatory types for a DOCX package', () => {
    const xml = buildContentTypesXml();
    expect(xml).toContain('Default Extension="rels"');
    expect(xml).toContain('Default Extension="png"');
    expect(xml).toContain('PartName="/word/document.xml"');
    expect(xml).toContain('wordprocessingml.document.main+xml');
  });
});

describe('buildRootRels', () => {
  it('points at word/document.xml as the office document', () => {
    const xml = buildRootRels();
    expect(xml).toContain('Target="word/document.xml"');
    expect(xml).toContain('relationships/officeDocument');
  });
});

describe('buildDocumentRels', () => {
  it('writes one image relationship per media item', () => {
    const xml = buildDocumentRels([
      { index: 1, bytes: new Uint8Array(), relId: 'rId11', widthEmu: 0, heightEmu: 0 },
      { index: 2, bytes: new Uint8Array(), relId: 'rId12', widthEmu: 0, heightEmu: 0 },
    ]);
    expect(xml).toContain('Id="rId11"');
    expect(xml).toContain('Id="rId12"');
    expect(xml).toContain('Target="media/image1.png"');
    expect(xml).toContain('Target="media/image2.png"');
  });
});

describe('buildDocumentXml', () => {
  it('includes the session title in a heading', () => {
    const xml = buildDocumentXml(sampleSession(), new Map());
    expect(xml).toContain('Heading1');
    expect(xml).toContain('GL posting fails');
  });

  it('xml-escapes special characters in the title', () => {
    const xml = buildDocumentXml(sampleSession(), new Map());
    expect(xml).toContain('&lt;bad&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;quotes&quot;');
  });

  it('includes every click step as a text paragraph', () => {
    const xml = buildDocumentXml(sampleSession(), new Map());
    expect(xml).toContain('[CLICK] Post');
  });

  it('includes every error step as a text paragraph', () => {
    const xml = buildDocumentXml(sampleSession(), new Map());
    expect(xml).toContain('[ERROR] Account X is not valid for posting.');
  });

  it('inserts an inline drawing for a step with a screenshot reference', () => {
    const media = new Map([
      ['img_1', { index: 1, bytes: new Uint8Array(), relId: 'rId11', widthEmu: 914400, heightEmu: 914400 }],
    ]);
    const xml = buildDocumentXml(sampleSession(), media);
    expect(xml).toContain('<w:drawing>');
    expect(xml).toContain('r:embed="rId11"');
  });
});

// ---------------------------------------------------------------- integration

describe('buildDocx', () => {
  it('produces a zip with the required OOXML parts', () => {
    const session = sampleSession();
    const snapshots = [
      { id: 'img_1', bytes: tinyPng() },
      { id: 'img_2', bytes: tinyPng() },
    ];
    const blob = buildDocx(session, snapshots);
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    // Unpack and check
    return blob.arrayBuffer().then((buf) => {
      const zip = new AdmZip(Buffer.from(buf));
      const names = zip.getEntries().map((e) => e.entryName);
      expect(names).toContain('[Content_Types].xml');
      expect(names).toContain('_rels/.rels');
      expect(names).toContain('word/document.xml');
      expect(names).toContain('word/_rels/document.xml.rels');
      expect(names).toContain('word/media/image1.png');
      expect(names).toContain('word/media/image2.png');

      const doc = zip.getEntry('word/document.xml')!.getData().toString('utf8');
      expect(doc).toContain('GL posting fails');
      expect(doc).toContain('[CLICK] Post');
      expect(doc).toContain('[ERROR] Account X');

      const rels = zip.getEntry('word/_rels/document.xml.rels')!.getData().toString('utf8');
      expect(rels).toContain('media/image1.png');
      expect(rels).toContain('media/image2.png');
    });
  });

  it('handles a session with zero screenshots', async () => {
    const session = sampleSession();
    session.steps = session.steps.filter((s) => !('screenshotId' in s));
    const blob = buildDocx(session, []);
    const buf = Buffer.from(await blob.arrayBuffer());
    const zip = new AdmZip(buf);
    const names = zip.getEntries().map((e) => e.entryName);
    expect(names).toContain('word/document.xml');
    expect(names.filter((n) => n.startsWith('word/media/'))).toHaveLength(0);
  });

  it('handles a session with zero steps', async () => {
    const session = sampleSession();
    session.steps = [];
    const blob = buildDocx(session, []);
    const buf = Buffer.from(await blob.arrayBuffer());
    const zip = new AdmZip(buf);
    const doc = zip.getEntry('word/document.xml')!.getData().toString('utf8');
    expect(doc).toContain('Steps to reproduce');
    expect(doc).toContain('GL posting fails');
  });
});

describe('exportSessionAsDocx', () => {
  beforeEach(() => {
    (globalThis.URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = vi
      .fn()
      .mockReturnValue('blob:mock-docx');
  });

  it('reads snapshots from IndexedDB and produces a filename', async () => {
    const session = sampleSession();
    const snap: SnapshotBlob = {
      id: 'img_1',
      sessionId: session.id,
      ts: 0,
      mime: 'image/png',
      data: new Blob([tinyPng() as BlobPart], { type: 'image/png' }),
    };
    await putSnapshot(snap);
    await putSnapshot({ ...snap, id: 'img_2' });

    const result = await exportSessionAsDocx(session);
    expect(result.url).toBe('blob:mock-docx');
    expect(result.filename).toMatch(/^d365fo-repro-\d{8}-\d{4}-gl-posting-fails-with-bad-chars-quotes\.docx$/);
  });
});
