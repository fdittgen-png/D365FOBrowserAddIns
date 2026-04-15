import type { Session, Step } from './types';
import { getSnapshotsBySession } from './storage';
import { buildZip, ZipEntry } from './zip';

/**
 * Exports a session as a .zip bundle containing:
 *   - repro.xml   : structured repro document
 *   - screenshots/step-NN.png (and pasted-NN.png)
 *   - metadata.json : raw session dump for machine reading
 *
 * Returns an object URL + suggested filename so the caller can feed them into
 * chrome.downloads.download.
 */

function xmlEscape(s: string | undefined | null): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tag(name: string, value: string | undefined, attrs: Record<string, string | undefined> = {}): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}="${xmlEscape(v!)}"`)
    .join(' ');
  const open = a ? `<${name} ${a}>` : `<${name}>`;
  if (value === undefined || value === '') return `${open.replace(/>$/, ' />')}`;
  return `${open}${xmlEscape(value)}</${name}>`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'repro';
}

function pad(n: number, w: number): string {
  return n.toString().padStart(w, '0');
}

function formatTs(ts: number): string {
  return new Date(ts).toISOString();
}

function formatDateTimeForFile(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}-${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}`;
}

export function buildReproXml(session: Session, attachmentMap: Map<string, string>): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<reproReport xmlns="https://d365fo.repro/schema/v1" version="1" sessionId="${xmlEscape(session.id)}">`,
  );

  lines.push('  <meta>');
  lines.push('    ' + tag('title', session.title || '(untitled)'));
  lines.push('    ' + tag('severity', session.severity));
  lines.push('    ' + tag('startedAt', formatTs(session.startedAt)));
  if (session.endedAt) lines.push('    ' + tag('endedAt', formatTs(session.endedAt)));
  lines.push('    ' + tag('extensionVersion', session.environment.extensionVersion));
  if (session.tags.length) {
    lines.push('    <tags>');
    for (const t of session.tags) lines.push('      ' + tag('tag', t));
    lines.push('    </tags>');
  }
  lines.push('  </meta>');

  lines.push('  <environment>');
  const env = session.environment;
  lines.push('    ' + tag('host', env.host));
  lines.push('    ' + tag('tenant', env.tenant));
  lines.push('    ' + tag('company', env.company));
  lines.push('    ' + tag('language', env.language));
  lines.push('    ' + tag('userAgent', env.userAgent));
  lines.push('    ' + tag('initialUrl', env.url));
  lines.push('  </environment>');

  lines.push('  ' + tag('description', session.description || ''));

  lines.push('  <steps>');
  session.steps.forEach((step, i) => {
    const idx = i + 1;
    const attrs: Record<string, string | undefined> = {
      index: String(idx),
      kind: step.kind,
      ts: formatTs(step.ts),
      id: step.id,
    };
    lines.push(`    <step ${Object.entries(attrs).map(([k, v]) => `${k}="${xmlEscape(v!)}"`).join(' ')}>`);
    renderStepBody(step, lines, attachmentMap);
    lines.push('    </step>');
  });
  lines.push('  </steps>');

  lines.push('</reproReport>');
  return lines.join('\n');
}

function renderStepBody(step: Step, lines: string[], attach: Map<string, string>): void {
  const indent = '      ';
  switch (step.kind) {
    case 'navigate':
      lines.push(indent + tag('formTitle', step.formTitle));
      lines.push(indent + tag('menuItem', step.menuItem));
      lines.push(indent + tag('company', step.company));
      lines.push(indent + tag('url', step.url));
      break;
    case 'click':
      lines.push(indent + tag('label', step.label));
      lines.push(indent + tag('role', step.role));
      lines.push(indent + tag('formTitle', step.formTitle));
      break;
    case 'edit':
      lines.push(indent + tag('fieldLabel', step.fieldLabel));
      lines.push(indent + tag('oldValue', step.oldValue));
      lines.push(indent + tag('newValue', step.newValue));
      lines.push(indent + tag('formTitle', step.formTitle));
      break;
    case 'error':
      lines.push(indent + tag('message', step.message));
      lines.push(indent + tag('formTitle', step.formTitle));
      break;
    case 'manual-snap':
      lines.push(indent + tag('formTitle', step.formTitle));
      break;
    case 'note':
      lines.push(indent + tag('text', step.text));
      break;
    case 'pasted-img':
      // nothing
      break;
  }
  if ('note' in step && step.note) lines.push(indent + tag('note', step.note));
  if ('screenshotId' in step && step.screenshotId) {
    const file = attach.get(step.screenshotId);
    if (file) lines.push(indent + `<attachment href="${xmlEscape(file)}" type="image/png" />`);
  }
}

export async function exportSessionAsZip(session: Session): Promise<{ url: string; filename: string }> {
  const snaps = await getSnapshotsBySession(session.id);
  const byId = new Map(snaps.map((s) => [s.id, s]));

  // Build deterministic filenames per step index
  const attachmentMap = new Map<string, string>(); // snapshotId -> filename
  let pastedCounter = 0;
  session.steps.forEach((step, i) => {
    if ('screenshotId' in step && step.screenshotId) {
      const snap = byId.get(step.screenshotId);
      if (!snap) return;
      const name =
        step.kind === 'pasted-img'
          ? `screenshots/pasted-${pad(++pastedCounter, 2)}.png`
          : `screenshots/step-${pad(i + 1, 3)}.png`;
      attachmentMap.set(step.screenshotId, name);
    }
  });

  const xml = buildReproXml(session, attachmentMap);
  const meta = JSON.stringify(session, null, 2);

  const entries: ZipEntry[] = [];
  entries.push({ name: 'repro.xml', data: new TextEncoder().encode(xml) });
  entries.push({ name: 'metadata.json', data: new TextEncoder().encode(meta) });
  for (const snap of snaps) {
    const file = attachmentMap.get(snap.id);
    if (!file) continue;
    const buf = new Uint8Array(await snap.data.arrayBuffer());
    entries.push({ name: file, data: buf });
  }

  const zipBlob = buildZip(entries);
  const url = URL.createObjectURL(zipBlob);
  const filename = `d365fo-repro-${formatDateTimeForFile(new Date())}-${slugify(session.title || 'untitled')}.zip`;
  return { url, filename };
}
