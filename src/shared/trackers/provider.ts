import type { Session } from '../types';

/**
 * A TrackerProvider is the abstraction every external ticket system plugs
 * into. Providers are stateless: all configuration comes from the caller,
 * so the same provider instance is reused across sessions and tabs.
 *
 * Adding a new tracker should only require a new file in this directory
 * and an entry in `./index.ts`. No other module in the codebase depends on
 * a specific provider, and every field in the options form is derived from
 * `getConfigSchema()`.
 */

export type FieldType =
  | 'text'
  | 'url'
  | 'password'
  | 'select'
  | 'textarea'
  | 'number'
  | 'boolean';

export interface ConfigField<TKey extends string = string> {
  key: TKey;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  /** For type=select, the list of allowed values. */
  options?: readonly { value: string; label: string }[];
  /** Marks the field as a secret so the options page renders type=password
   *  and the exporter never includes it in debug output. */
  secret?: boolean;
  /** Default value applied when the user first opens the form. */
  default?: string | number | boolean;
}

export interface ConfigSchema {
  fields: readonly ConfigField[];
  /** A help message shown above the form. */
  intro?: string;
  /** Optional link to the provider's API docs. */
  docsUrl?: string;
}

export interface Attachment {
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

export interface ValidationResult {
  ok: boolean;
  errors?: Record<string, string>;
}

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface SubmitResult {
  ticketId?: string;
  ticketNumber?: string;
  ticketUrl?: string;
  raw: unknown;
}

export interface TrackerProvider<Config = Record<string, unknown>> {
  readonly id: string;
  readonly displayName: string;
  getConfigSchema(): ConfigSchema;
  validateConfig(config: Config): ValidationResult;
  testConnection(config: Config): Promise<TestResult>;
  submit(session: Session, config: Config, attachments: Attachment[]): Promise<SubmitResult>;
}

/**
 * Apply schema defaults to a possibly-partial config object. Used by the
 * options page on first load.
 */
export function applyDefaults(schema: ConfigSchema, partial: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...partial };
  for (const f of schema.fields) {
    if (out[f.key] === undefined && f.default !== undefined) out[f.key] = f.default;
  }
  return out;
}

/**
 * Shared validator that checks required fields according to the schema.
 * Providers can build on top of this for provider-specific rules.
 */
export function validateRequired(schema: ConfigSchema, config: Record<string, unknown>): ValidationResult {
  const errors: Record<string, string> = {};
  for (const f of schema.fields) {
    if (!f.required) continue;
    const v = config[f.key];
    if (v === undefined || v === null || v === '') errors[f.key] = `${f.label} is required`;
  }
  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
}
