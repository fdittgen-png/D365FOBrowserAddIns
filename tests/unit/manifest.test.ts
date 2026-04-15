// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/manifest.json'), 'utf8'),
);

const BANNED = ['<all_urls>', 'http://*/*', 'https://*/*', '*://*/*'];

describe('manifest.json permissions', () => {
  it('does not declare wildcard host permissions in permissions[]', () => {
    const perms: string[] = manifest.permissions ?? [];
    for (const b of BANNED) expect(perms).not.toContain(b);
  });

  it('does not declare wildcard in host_permissions[]', () => {
    const perms: string[] = manifest.host_permissions ?? [];
    for (const b of BANNED) expect(perms).not.toContain(b);
  });

  it('does not declare wildcard in optional_host_permissions[]', () => {
    const perms: string[] = manifest.optional_host_permissions ?? [];
    for (const b of BANNED) expect(perms).not.toContain(b);
  });

  it('optional_host_permissions covers Jira Cloud, Atlassian, Azure DevOps', () => {
    const perms: string[] = manifest.optional_host_permissions ?? [];
    expect(perms).toEqual(expect.arrayContaining([
      'https://*.atlassian.net/*',
      'https://dev.azure.com/*',
    ]));
  });

  it('host_permissions scoped to D365FO hosts', () => {
    const perms: string[] = manifest.host_permissions ?? [];
    expect(perms).toEqual(expect.arrayContaining([
      'https://*.dynamics.com/*',
    ]));
    // Every entry must be a specific dynamics.com subtree, never a
    // scheme-wide or all-urls pattern.
    for (const p of perms) {
      expect(p).toMatch(/dynamics\.com/);
    }
  });
});
