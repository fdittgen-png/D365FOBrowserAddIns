import type { Session, Step } from '../types';
import { buildReproXml } from '../exporter';
import { getSnapshotsBySession } from '../storage';
import type { Attachment } from './provider';

/**
 * Shared helpers used by every provider: build the repro.xml attachment,
 * collect screenshots from IndexedDB, and render a plain-text description
 * that reads well in a ticket body.
 */

export async function collectAttachments(session: Session): Promise<{
  attachments: Attachment[];
  xml: string;
}> {
  const snaps = await getSnapshotsBySession(session.id);
  const attachmentMap = new Map<string, string>();
  let pastedN = 0;
  session.steps.forEach((s, i) => {
    if ('screenshotId' in s && s.screenshotId) {
      const name =
        s.kind === 'pasted-img'
          ? `pasted-${String(++pastedN).padStart(2, '0')}.png`
          : `step-${String(i + 1).padStart(3, '0')}.png`;
      attachmentMap.set(s.screenshotId, name);
    }
  });

  const xml = buildReproXml(session, attachmentMap);
  const attachments: Attachment[] = [];
  attachments.push({
    filename: 'repro.xml',
    mime: 'application/xml; charset=utf-8',
    bytes: new TextEncoder().encode(xml),
  });
  for (const snap of snaps) {
    const name = attachmentMap.get(snap.id);
    if (!name) continue;
    attachments.push({
      filename: name,
      mime: snap.mime,
      bytes: new Uint8Array(await snap.data.arrayBuffer()),
    });
  }
  return { attachments, xml };
}

export function buildTicketSubject(session: Session, fallback = 'D365FO issue'): string {
  const t = session.title?.trim() || fallback;
  const parts = [t];
  if (session.environment.company) parts.push(`[${session.environment.company}]`);
  return parts.join(' ').slice(0, 180);
}

export function buildPlainDescription(session: Session): string {
  const lines: string[] = [];
  lines.push(`Severity: ${session.severity}`);
  if (session.tags.length) lines.push(`Tags: ${session.tags.join(', ')}`);
  lines.push('');
  lines.push('Description:');
  lines.push(session.description || '(none)');
  lines.push('');
  lines.push('Environment:');
  const e = session.environment;
  lines.push(`  Host:     ${e.host}`);
  lines.push(`  Company:  ${e.company ?? ''}`);
  lines.push(`  Tenant:   ${e.tenant ?? ''}`);
  lines.push(`  Language: ${e.language ?? ''}`);
  lines.push(`  URL:      ${e.url}`);
  lines.push(`  Ext:      ${e.extensionVersion}`);
  lines.push(`  UA:       ${e.userAgent}`);
  lines.push('');
  lines.push('Steps to reproduce:');
  session.steps.forEach((s, i) => appendStepLine(lines, s, i));
  lines.push('');
  lines.push('See attached repro.xml for the structured document and the screenshots for visuals.');
  return lines.join('\n');
}

function appendStepLine(lines: string[], s: Step, i: number): void {
  const idx = (i + 1).toString().padStart(2, ' ');
  switch (s.kind) {
    case 'navigate':
      lines.push(`${idx}. [NAV]   ${s.formTitle ?? s.menuItem ?? s.url}`);
      break;
    case 'click':
      lines.push(`${idx}. [CLICK] ${s.label} ${s.formTitle ? `(${s.formTitle})` : ''}`);
      break;
    case 'edit':
      lines.push(`${idx}. [EDIT]  ${s.fieldLabel}: "${s.oldValue}" -> "${s.newValue}"`);
      break;
    case 'error':
      lines.push(`${idx}. [ERROR] ${s.message}`);
      break;
    case 'manual-snap':
      lines.push(`${idx}. [SNAP]  ${s.note ?? '(manual snapshot)'}`);
      break;
    case 'note':
      lines.push(`${idx}. [NOTE]  ${s.text}`);
      break;
    case 'pasted-img':
      lines.push(`${idx}. [IMG]   ${s.note ?? '(pasted image)'}`);
      break;
  }
  if ('note' in s && s.note && s.kind !== 'manual-snap' && s.kind !== 'pasted-img') {
    lines.push(`       note: ${s.note}`);
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function ensureHostPermission(baseUrl: string): Promise<void> {
  try {
    const origin = new URL(baseUrl).origin + '/*';
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (has) return;
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) throw new Error('Host permission for the tracker endpoint was denied');
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Host permission')) throw e;
    // permissions API missing in this context — the fetch below will surface the real reason
  }
}
