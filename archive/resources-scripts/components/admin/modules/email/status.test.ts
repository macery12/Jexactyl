import { describe, expect, it } from 'vitest';
import { getEmailStatusPresentation } from './status';

describe('email status presentation', () => {
    it('keeps deferred distinct from failed', () => {
        expect(getEmailStatusPresentation('deferred').label).toBe('DEFERRED');
        expect(getEmailStatusPresentation('deferred').tone).toBe('warning');
    });

    it('keeps skipped distinct from failed', () => {
        expect(getEmailStatusPresentation('skipped').label).toBe('SKIPPED');
        expect(getEmailStatusPresentation('skipped').tone).toBe('neutral');
    });

    it('preserves failed mapping', () => {
        expect(getEmailStatusPresentation('failed').label).toBe('FAILED');
        expect(getEmailStatusPresentation('failed').tone).toBe('danger');
    });
});
