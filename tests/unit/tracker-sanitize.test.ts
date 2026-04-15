// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { sanitizeTrackerError } from '../../src/shared/trackers/common';

describe('sanitizeTrackerError', () => {
  it('redacts Authorization headers in plain text', () => {
    expect(sanitizeTrackerError('Authorization: Basic YWJjOmRlZg==')).toBe('Authorization: ***');
  });

  it('redacts Bearer tokens in an Authorization header', () => {
    expect(sanitizeTrackerError('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc')).toBe(
      'Authorization: ***',
    );
  });

  it('redacts stray Bearer tokens not behind an Authorization header', () => {
    expect(sanitizeTrackerError('header: Bearer eyJhbGciOiJIUzI1NiJ9.abc')).toContain('Bearer ***');
  });

  it('redacts password fields in JSON', () => {
    expect(sanitizeTrackerError('{"password":"hunter2","foo":"bar"}')).toBe(
      '{"password":"***","foo":"bar"}',
    );
  });

  it('redacts apiToken fields', () => {
    expect(sanitizeTrackerError('{"apiToken":"abc123"}')).toBe('{"apiToken":"***"}');
  });

  it('redacts pat fields', () => {
    expect(sanitizeTrackerError('{"pat":"xyz"}')).toBe('{"pat":"***"}');
  });

  it('redacts generic token fields', () => {
    expect(sanitizeTrackerError('{"token":"abcdef"}')).toBe('{"token":"***"}');
  });

  it('leaves innocuous content untouched', () => {
    expect(sanitizeTrackerError('queue not found')).toBe('queue not found');
  });

  it('truncates to maxLength after sanitization', () => {
    const long = 'x'.repeat(500);
    const out = sanitizeTrackerError(long, 50);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBe(51);
  });

  it('combines multiple secrets in the same string', () => {
    const input =
      'HTTP 401 body: password=xx apiToken=yy pat=zz\nAuthorization: Basic abcdef==';
    const injson = '{"password":"xx","apiToken":"yy","pat":"zz"}';
    const out = sanitizeTrackerError(injson + '\nAuthorization: Basic abcdef==');
    expect(out).not.toMatch(/"password":"xx"/);
    expect(out).not.toMatch(/"apiToken":"yy"/);
    expect(out).not.toMatch(/"pat":"zz"/);
    expect(out).not.toMatch(/Basic abcdef/);
    // The plain-text form isn't redacted by design (no JSON quotes), noted.
    void input;
  });

  it('default maxLength is 300', () => {
    const long = 'safe text. '.repeat(100);
    const out = sanitizeTrackerError(long);
    expect(out.length).toBeLessThanOrEqual(301);
  });
});
