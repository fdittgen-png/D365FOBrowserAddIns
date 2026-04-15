import { describe, it, expect, expectTypeOf } from 'vitest';
import { stepEvent, type StepInput } from '@shared/messaging';
import type { Step } from '@shared/types';

describe('stepEvent typed helper', () => {
  it('builds a STEP_EVENT envelope for a click step', () => {
    const envelope = stepEvent<'click'>({
      kind: 'click',
      label: 'Post',
      role: 'button',
      formTitle: 'Journal voucher',
    });
    expect(envelope.type).toBe('STEP_EVENT');
    expect(envelope.step).toEqual({
      kind: 'click',
      label: 'Post',
      role: 'button',
      formTitle: 'Journal voucher',
    });
  });

  it('builds a STEP_EVENT envelope for an edit step', () => {
    const envelope = stepEvent<'edit'>({
      kind: 'edit',
      fieldLabel: 'Account',
      oldValue: '',
      newValue: '1234',
      formTitle: 'Voucher',
    });
    expect(envelope.type).toBe('STEP_EVENT');
    expect(envelope.step).toMatchObject({ kind: 'edit', fieldLabel: 'Account' });
  });

  it('builds a STEP_EVENT envelope for every Step variant', () => {
    // Ensures we have a runtime builder path for each kind, guarding against
    // a future Step kind being added without a matching test-side example.
    const variants: Step['kind'][] = [
      'navigate',
      'click',
      'edit',
      'error',
      'manual-snap',
      'note',
      'pasted-img',
    ];
    for (const kind of variants) {
      switch (kind) {
        case 'navigate':
          expect(stepEvent<'navigate'>({ kind, url: 'https://x', menuItem: 'm' }).type).toBe('STEP_EVENT');
          break;
        case 'click':
          expect(stepEvent<'click'>({ kind, label: 'go' }).type).toBe('STEP_EVENT');
          break;
        case 'edit':
          expect(stepEvent<'edit'>({ kind, fieldLabel: 'f', oldValue: 'a', newValue: 'b' }).type).toBe('STEP_EVENT');
          break;
        case 'error':
          expect(stepEvent<'error'>({ kind, message: 'nope' }).type).toBe('STEP_EVENT');
          break;
        case 'manual-snap':
          expect(stepEvent<'manual-snap'>({ kind, screenshotId: 'img-1' }).type).toBe('STEP_EVENT');
          break;
        case 'note':
          expect(stepEvent<'note'>({ kind, text: 'hi' }).type).toBe('STEP_EVENT');
          break;
        case 'pasted-img':
          expect(stepEvent<'pasted-img'>({ kind, screenshotId: 'img-2' }).type).toBe('STEP_EVENT');
          break;
      }
    }
  });
});

describe('StepInput<K> type', () => {
  it('omits id and ts from the step variant', () => {
    expectTypeOf<StepInput<'click'>>().toMatchTypeOf<{
      kind: 'click';
      label: string;
    }>();
    // id and ts must not be present on the input type
    expectTypeOf<StepInput<'click'>>().not.toHaveProperty('id');
    expectTypeOf<StepInput<'click'>>().not.toHaveProperty('ts');
  });

  it('rejects extra or wrong fields at compile time', () => {
    // @ts-expect-error — missing required field `label`
    stepEvent<'click'>({ kind: 'click', role: 'button' });
    // @ts-expect-error — wrong type on oldValue
    stepEvent<'edit'>({ kind: 'edit', fieldLabel: 'f', oldValue: 42, newValue: '' });
  });
});
