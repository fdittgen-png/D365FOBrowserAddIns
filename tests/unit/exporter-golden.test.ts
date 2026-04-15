// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildReproXml } from '../../src/shared/exporter';
import type { Session } from '../../src/shared/types';

/**
 * Golden-file regression test for the exporter's XML output shape.
 * Any change to the XML format is a deliberate schema decision — update
 * the golden file in the same PR so the diff is reviewable.
 *
 * Set UPDATE_GOLDEN=1 when regenerating:
 *   cross-env UPDATE_GOLDEN=1 npm test -- exporter-golden
 */

const goldenPath = resolve(__dirname, '../fixtures/golden-repro.xml');

function fixedSession(): Session {
  return {
    id: 'ses_golden',
    tabId: 1,
    state: 'stopped',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_060_000,
    title: 'Golden fixture',
    description: 'A deterministic fixture used by the schema regression test.',
    severity: 'high',
    tags: ['golden', 'fixture'],
    environment: {
      url: 'https://usmf.dynamics.com/?cmp=USMF&mi=LedgerJournalTable',
      host: 'usmf.dynamics.com',
      tenant: 'usmf',
      company: 'USMF',
      language: 'en-us',
      userAgent: 'GoldenAgent/1.0',
      extensionVersion: '0.1.0',
      capturedAt: 1_700_000_000_000,
    },
    steps: [
      {
        kind: 'navigate',
        id: 'st_1',
        ts: 1_700_000_001_000,
        url: 'https://usmf.dynamics.com/?cmp=USMF&mi=LedgerJournalTable',
        menuItem: 'LedgerJournalTable',
        company: 'USMF',
        formTitle: 'General journal entries',
        screenshotId: 'img_1',
      },
      {
        kind: 'click',
        id: 'st_2',
        ts: 1_700_000_002_000,
        label: 'New',
        role: 'button',
        formTitle: 'General journal entries',
      },
      {
        kind: 'edit',
        id: 'st_3',
        ts: 1_700_000_003_000,
        fieldLabel: 'Journal name',
        oldValue: '',
        newValue: 'GenJrn',
        formTitle: 'Journal voucher',
      },
      {
        kind: 'error',
        id: 'st_4',
        ts: 1_700_000_004_000,
        message: 'Account X is not valid for posting.',
        formTitle: 'Journal voucher',
        screenshotId: 'img_2',
      },
      {
        kind: 'note',
        id: 'st_5',
        ts: 1_700_000_005_000,
        text: 'This is reproducible on every attempt.',
      },
    ],
  };
}

describe('exporter golden file', () => {
  it('buildReproXml output matches the checked-in golden fixture', () => {
    const session = fixedSession();
    const attachments = new Map<string, string>([
      ['img_1', 'screenshots/step-001.png'],
      ['img_2', 'screenshots/step-004.png'],
    ]);
    const xml = buildReproXml(session, attachments);

    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(goldenPath)) {
      writeFileSync(goldenPath, xml);
      console.warn('[golden] wrote', goldenPath);
    }

    const expected = readFileSync(goldenPath, 'utf8');
    expect(xml).toBe(expected);
  });
});
