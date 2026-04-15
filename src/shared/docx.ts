import type { Session, Step, SnapshotBlob } from './types';
import { getSnapshotsBySession } from './storage';
import { buildZip, type ZipEntry } from './zip';

/**
 * DOCX exporter. Produces a minimal OOXML WordprocessingML document that
 * opens cleanly in Word 2016+ and LibreOffice Writer. The output is
 * intentionally bare: no styles.xml, no themes, no numbering — just the
 * parts every viewer needs to render text + inline PNGs.
 *
 * A DOCX file is just a ZIP of specific XML parts. We reuse the existing
 * STORE-mode zip writer (src/shared/zip.ts) so there is no new runtime
 * dependency on a Word library.
 *
 * Structure:
 *   [Content_Types].xml
 *   _rels/.rels
 *   word/document.xml
 *   word/_rels/document.xml.rels
 *   word/media/image1.png
 *   word/media/image2.png
 *   ...
 */

const EMU_PER_INCH = 914_400;
const PIXELS_PER_INCH = 96;
const MAX_IMAGE_WIDTH_EMU = 6 * EMU_PER_INCH; // 6 inches wide

interface MediaItem {
  /** 1-based index used in the relationship id (rIdN) and filename (imageN.png). */
  index: number;
  /** PNG bytes as stored in IndexedDB. */
  bytes: Uint8Array;
  /** Relationship id referenced from document.xml. */
  relId: string;
  widthEmu: number;
  heightEmu: number;
}

/**
 * Parse a PNG IHDR chunk to recover pixel dimensions. Returns null for
 * non-PNG bytes; the caller should fall back to a default size.
 */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return { width, height };
}

/**
 * Scale pixel dimensions to EMU, clamping width to MAX_IMAGE_WIDTH_EMU
 * and preserving aspect ratio.
 */
export function computeImageEmu(width: number, height: number): { widthEmu: number; heightEmu: number } {
  let widthEmu = Math.round((width / PIXELS_PER_INCH) * EMU_PER_INCH);
  let heightEmu = Math.round((height / PIXELS_PER_INCH) * EMU_PER_INCH);
  if (widthEmu <= 0 || heightEmu <= 0) {
    return { widthEmu: MAX_IMAGE_WIDTH_EMU, heightEmu: Math.round(MAX_IMAGE_WIDTH_EMU * 0.625) };
  }
  if (widthEmu > MAX_IMAGE_WIDTH_EMU) {
    heightEmu = Math.round((heightEmu * MAX_IMAGE_WIDTH_EMU) / widthEmu);
    widthEmu = MAX_IMAGE_WIDTH_EMU;
  }
  return { widthEmu, heightEmu };
}

function xmlEscape(s: string | undefined | null): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Word's `<w:t>` requires `xml:space="preserve"` when leading/trailing whitespace matters. */
function wText(text: string): string {
  return `<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function paragraph(text: string, style?: 'Heading1' | 'Heading2'): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${pPr}${wText(text)}</w:p>`;
}

function heading1(text: string): string {
  return paragraph(text, 'Heading1');
}

function heading2(text: string): string {
  return paragraph(text, 'Heading2');
}

function imageParagraph(media: MediaItem): string {
  // Inline image drawing — the minimum Word accepts. `r:embed` references
  // the relationship declared in word/_rels/document.xml.rels.
  return `<w:p><w:r><w:drawing>
    <wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
      <wp:extent cx="${media.widthEmu}" cy="${media.heightEmu}"/>
      <wp:effectExtent l="0" t="0" r="0" b="0"/>
      <wp:docPr id="${media.index}" name="Picture ${media.index}"/>
      <wp:cNvGraphicFramePr>
        <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
      </wp:cNvGraphicFramePr>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:nvPicPr>
              <pic:cNvPr id="${media.index}" name="image${media.index}.png"/>
              <pic:cNvPicPr/>
            </pic:nvPicPr>
            <pic:blipFill>
              <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${media.relId}"/>
              <a:stretch><a:fillRect/></a:stretch>
            </pic:blipFill>
            <pic:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="${media.widthEmu}" cy="${media.heightEmu}"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            </pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:inline>
  </w:drawing></w:r></w:p>`;
}

function stepSummary(step: Step): string {
  switch (step.kind) {
    case 'navigate':
      return `[NAV] ${step.formTitle ?? step.menuItem ?? step.url}`;
    case 'click':
      return `[CLICK] ${step.label}${step.formTitle ? ` (${step.formTitle})` : ''}`;
    case 'edit':
      return `[EDIT] ${step.fieldLabel}: "${step.oldValue}" → "${step.newValue}"`;
    case 'error':
      return `[ERROR] ${step.message}`;
    case 'manual-snap':
      return `[SNAP] ${step.note ?? '(manual snapshot)'}`;
    case 'note':
      return `[NOTE] ${step.text}`;
    case 'pasted-img':
      return `[IMG] ${step.note ?? '(pasted image)'}`;
  }
}

/**
 * Build the `word/document.xml` body string for a session. Exported for
 * unit testing — the exporter orchestrator calls it via `buildDocx`.
 */
export function buildDocumentXml(session: Session, media: Map<string, MediaItem>): string {
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
  );
  parts.push('<w:body>');

  parts.push(heading1(session.title || '(untitled)'));

  parts.push(paragraph(`Severity: ${session.severity}`));
  if (session.tags.length) parts.push(paragraph(`Tags: ${session.tags.join(', ')}`));
  const e = session.environment;
  if (e.host) parts.push(paragraph(`Host: ${e.host}`));
  if (e.company) parts.push(paragraph(`Company: ${e.company}`));
  if (e.tenant) parts.push(paragraph(`Tenant: ${e.tenant}`));
  if (e.language) parts.push(paragraph(`Language: ${e.language}`));
  if (e.url) parts.push(paragraph(`URL: ${e.url}`));
  parts.push(paragraph(`Extension: ${e.extensionVersion}`));

  if (session.description) {
    parts.push(heading2('Description'));
    parts.push(paragraph(session.description));
  }

  parts.push(heading2('Steps to reproduce'));
  session.steps.forEach((step, i) => {
    parts.push(paragraph(`${i + 1}. ${stepSummary(step)}`));
    if ('note' in step && step.note) parts.push(paragraph(`   Note: ${step.note}`));
    if ('screenshotId' in step && step.screenshotId) {
      const m = media.get(step.screenshotId);
      if (m) parts.push(imageParagraph(m));
    }
  });

  parts.push(
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>',
  );
  parts.push('</w:body></w:document>');
  return parts.join('\n');
}

export function buildContentTypesXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '  <Default Extension="xml" ContentType="application/xml"/>',
    '  <Default Extension="png" ContentType="image/png"/>',
    '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '</Types>',
  ].join('\n');
}

export function buildRootRels(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>',
  ].join('\n');
}

export function buildDocumentRels(media: MediaItem[]): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  ];
  for (const m of media) {
    lines.push(
      `  <Relationship Id="${m.relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${m.index}.png"/>`,
    );
  }
  lines.push('</Relationships>');
  return lines.join('\n');
}

/**
 * Build a DOCX blob for the given session + its snapshots. Pure: no I/O,
 * so tests can call this directly with fake data.
 */
export function buildDocx(session: Session, snapshots: Array<{ id: string; bytes: Uint8Array }>): Blob {
  const snapshotById = new Map(snapshots.map((s) => [s.id, s.bytes]));

  // Build the media items map only for snapshots that are actually
  // referenced by a step with a screenshotId. Orphaned blobs are skipped.
  const media: MediaItem[] = [];
  const mediaByStepSnapshotId = new Map<string, MediaItem>();
  let index = 0;
  for (const step of session.steps) {
    if (!('screenshotId' in step) || !step.screenshotId) continue;
    const bytes = snapshotById.get(step.screenshotId);
    if (!bytes) continue;
    index++;
    const dims = pngDimensions(bytes) ?? { width: 800, height: 600 };
    const { widthEmu, heightEmu } = computeImageEmu(dims.width, dims.height);
    const item: MediaItem = {
      index,
      bytes,
      relId: `rId${index + 10}`,
      widthEmu,
      heightEmu,
    };
    media.push(item);
    mediaByStepSnapshotId.set(step.screenshotId, item);
  }

  const documentXml = buildDocumentXml(session, mediaByStepSnapshotId);
  const contentTypes = buildContentTypesXml();
  const rootRels = buildRootRels();
  const documentRels = buildDocumentRels(media);

  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { name: '_rels/.rels', data: encoder.encode(rootRels) },
    { name: 'word/document.xml', data: encoder.encode(documentXml) },
    { name: 'word/_rels/document.xml.rels', data: encoder.encode(documentRels) },
  ];
  for (const m of media) {
    entries.push({ name: `word/media/image${m.index}.png`, data: m.bytes });
  }
  const blob = buildZip(entries);
  // Override MIME type so browsers offer the right download prompt.
  return new Blob([blob as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

function pad(n: number, w: number): string {
  return n.toString().padStart(w, '0');
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'repro'
  );
}

function formatDateTimeForFile(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}-${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}`;
}

/**
 * Orchestrator used by the service worker's REVIEW_EXPORT_DOCX handler.
 * Pulls the session's snapshots from IndexedDB, builds the docx blob,
 * and returns an object URL + a sensible filename.
 */
export async function exportSessionAsDocx(session: Session): Promise<{ url: string; filename: string }> {
  const snaps = await getSnapshotsBySession(session.id);
  const withBytes = await Promise.all(
    snaps.map(async (s: SnapshotBlob) => ({
      id: s.id,
      bytes: new Uint8Array(await s.data.arrayBuffer()),
    })),
  );
  const blob = buildDocx(session, withBytes);
  const url = URL.createObjectURL(blob);
  const filename = `d365fo-repro-${formatDateTimeForFile(new Date())}-${slugify(session.title || 'untitled')}.docx`;
  return { url, filename };
}
