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
  bytesToBase64,
  ensureHostPermission,
} from './common';

export interface OtrsConfig extends Record<string, unknown> {
  baseUrl: string;
  webservice: string;
  user: string;
  password: string;
  queue: string;
  type: string;
  priority: string;
  state: string;
}

const SCHEMA: ConfigSchema = {
  intro:
    'OTRS uses the GenericTicketConnectorREST web service. Point the base URL at your OTRS host and set the web service name to the REST connector you have enabled.',
  docsUrl: 'https://doc.otrs.com/doc/manual/admin/stable/en/content/generic-interface/index.html',
  fields: [
    { key: 'baseUrl', label: 'Base URL', type: 'url', required: true, placeholder: 'https://otrs.example.com' },
    { key: 'webservice', label: 'Web service name', type: 'text', required: true, placeholder: 'GenericTicketConnectorREST' },
    { key: 'user', label: 'User login', type: 'text', required: true },
    { key: 'password', label: 'Password', type: 'password', required: true, secret: true },
    { key: 'queue', label: 'Queue', type: 'text', required: true, placeholder: 'Support::D365FO' },
    { key: 'type', label: 'Ticket type', type: 'text', default: 'Incident' },
    {
      key: 'priority',
      label: 'Priority',
      type: 'select',
      default: '3 normal',
      options: [
        { value: '1 very low', label: '1 very low' },
        { value: '2 low', label: '2 low' },
        { value: '3 normal', label: '3 normal' },
        { value: '4 high', label: '4 high' },
        { value: '5 very high', label: '5 very high' },
      ],
    },
    { key: 'state', label: 'State', type: 'text', default: 'new' },
  ],
};

export class OtrsProvider implements TrackerProvider<OtrsConfig> {
  readonly id = 'otrs';
  readonly displayName = 'OTRS';

  getConfigSchema(): ConfigSchema {
    return SCHEMA;
  }

  validateConfig(config: OtrsConfig): ValidationResult {
    return validateRequired(SCHEMA, config);
  }

  async testConnection(config: OtrsConfig): Promise<TestResult> {
    await ensureHostPermission(config.baseUrl);
    const url = this.endpoint(config, 'SessionCreate');
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ UserLogin: config.user, Password: config.password }),
      });
      const text = await resp.text();
      if (resp.ok) return { ok: true, message: `HTTP ${resp.status} — ${truncate(text, 120)}` };
      return { ok: false, message: `HTTP ${resp.status} — ${truncate(text, 200)}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async submit(session: Session, config: OtrsConfig, attachments: Attachment[]): Promise<SubmitResult> {
    await ensureHostPermission(config.baseUrl);
    const otrsAttachments = attachments.map((a) => ({
      Content: bytesToBase64(a.bytes),
      ContentType: a.mime,
      Filename: a.filename,
    }));
    const body = {
      UserLogin: config.user,
      Password: config.password,
      Ticket: {
        Title: buildTicketSubject(session),
        Queue: config.queue,
        Type: config.type || 'Incident',
        State: config.state || 'new',
        Priority: config.priority || '3 normal',
        CustomerUser: config.user,
      },
      Article: {
        Subject: buildTicketSubject(session),
        Body: buildPlainDescription(session),
        ContentType: 'text/plain; charset=utf-8',
        MimeType: 'text/plain',
        Charset: 'utf-8',
      },
      Attachment: otrsAttachments,
    };
    const resp = await fetch(this.endpoint(config, 'Ticket'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
    if (!resp.ok) throw new Error(`OTRS returned ${resp.status}: ${truncate(text, 300)}`);
    const obj = parsed as {
      TicketNumber?: string;
      TicketID?: string;
      Error?: { ErrorMessage?: string; ErrorCode?: string };
    };
    if (obj.Error) throw new Error(`OTRS error ${obj.Error.ErrorCode ?? ''}: ${obj.Error.ErrorMessage ?? 'unknown'}`);
    const ticketUrl = obj.TicketID
      ? `${config.baseUrl.replace(/\/$/, '')}/otrs/index.pl?Action=AgentTicketZoom;TicketID=${obj.TicketID}`
      : undefined;
    return { ticketId: obj.TicketID, ticketNumber: obj.TicketNumber, ticketUrl, raw: parsed };
  }

  private endpoint(config: OtrsConfig, op: 'Ticket' | 'SessionCreate'): string {
    return `${config.baseUrl.replace(/\/$/, '')}/otrs/nph-genericinterface.pl/Webservice/${encodeURIComponent(config.webservice)}/${op}`;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
