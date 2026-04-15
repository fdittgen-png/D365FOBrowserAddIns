import type { Session } from './types';
import { getOtrsConfig, getSnapshotsBySession } from './storage';
import { buildReproXml } from './exporter';

/**
 * Submits the given session as a new OTRS ticket via the GenericTicketConnectorREST
 * web service. Screenshots are attached as base64 PNGs. The repro XML is
 * attached as repro.xml so a developer opening the ticket gets the structured
 * document plus the originals.
 *
 * OTRS REST API reference:
 *   POST {baseUrl}/otrs/nph-genericinterface.pl/Webservice/{webservice}/Ticket
 *   Body: JSON { UserLogin, Password, Ticket, Article, Attachment[] }
 */

export interface OtrsSubmitResult {
  ticketNumber?: string;
  ticketId?: string;
  raw: unknown;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(bin);
}

function sessionToTicketSubject(session: Session): string {
  const t = session.title?.trim() || 'D365FO issue';
  const env = session.environment;
  const parts = [t];
  if (env.company) parts.push(`[${env.company}]`);
  return parts.join(' ').slice(0, 180);
}

function sessionToArticleBody(session: Session): string {
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
  lines.push(`  User agent: ${e.userAgent}`);
  lines.push('');
  lines.push('Steps to reproduce:');
  session.steps.forEach((s, i) => {
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
  });
  lines.push('');
  lines.push('See attached repro.xml for the structured document and the screenshots for visuals.');
  return lines.join('\n');
}

async function ensureHostPermission(baseUrl: string): Promise<void> {
  try {
    const origin = new URL(baseUrl).origin + '/*';
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (has) return;
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) throw new Error('Permission to access OTRS host was denied');
  } catch (e) {
    // permissions API unavailable in some contexts — let fetch fail with a clearer error below
    console.warn('[repro] permissions check failed', e);
  }
}

export async function submitToOtrs(session: Session): Promise<OtrsSubmitResult> {
  const cfg = await getOtrsConfig();
  if (!cfg) throw new Error('OTRS is not configured — open Settings and fill in the form first.');
  if (!cfg.baseUrl || !cfg.webservice) throw new Error('OTRS base URL / web service missing');

  await ensureHostPermission(cfg.baseUrl);

  const snaps = await getSnapshotsBySession(session.id);

  // Build XML (same content as in the zip export) and encode it as a text attachment
  const attachmentMap = new Map<string, string>();
  let pastedN = 0;
  session.steps.forEach((s, i) => {
    if ('screenshotId' in s && s.screenshotId) {
      const name = s.kind === 'pasted-img'
        ? `pasted-${String(++pastedN).padStart(2, '0')}.png`
        : `step-${String(i + 1).padStart(3, '0')}.png`;
      attachmentMap.set(s.screenshotId, name);
    }
  });
  const xml = buildReproXml(session, attachmentMap);

  const attachments: Array<{ Content: string; ContentType: string; Filename: string }> = [];
  attachments.push({
    Content: btoa(unescape(encodeURIComponent(xml))),
    ContentType: 'application/xml; charset=utf-8',
    Filename: 'repro.xml',
  });
  for (const snap of snaps) {
    const name = attachmentMap.get(snap.id);
    if (!name) continue;
    attachments.push({
      Content: await blobToBase64(snap.data),
      ContentType: snap.mime,
      Filename: name,
    });
  }

  const body = {
    UserLogin: cfg.user,
    Password: cfg.password,
    Ticket: {
      Title: sessionToTicketSubject(session),
      Queue: cfg.queue,
      Type: cfg.type || 'Incident',
      State: cfg.state || 'new',
      Priority: cfg.priority || '3 normal',
      CustomerUser: cfg.user,
    },
    Article: {
      Subject: sessionToTicketSubject(session),
      Body: sessionToArticleBody(session),
      ContentType: 'text/plain; charset=utf-8',
      MimeType: 'text/plain',
      Charset: 'utf-8',
    },
    Attachment: attachments,
  };

  const url = `${cfg.baseUrl.replace(/\/$/, '')}/otrs/nph-genericinterface.pl/Webservice/${encodeURIComponent(cfg.webservice)}/Ticket`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!resp.ok) {
    throw new Error(`OTRS returned ${resp.status}: ${text.slice(0, 300)}`);
  }
  const obj = parsed as { TicketNumber?: string; TicketID?: string; Error?: { ErrorMessage?: string; ErrorCode?: string } };
  if (obj.Error) throw new Error(`OTRS error ${obj.Error.ErrorCode ?? ''}: ${obj.Error.ErrorMessage ?? 'unknown'}`);
  return { ticketNumber: obj.TicketNumber, ticketId: obj.TicketID, raw: parsed };
}
