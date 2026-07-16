import { describe, expect, it } from 'vitest';
import { isValidServerUuid } from './helpers';

describe('isValidServerUuid', () => {
    it('accepts a canonical lowercase UUID', () => {
        expect(isValidServerUuid('a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBe(true);
    });

    it('accepts a canonical uppercase UUID', () => {
        expect(isValidServerUuid('A1B2C3D4-E5F6-7890-ABCD-EF1234567890')).toBe(true);
    });

    it('rejects null', () => {
        expect(isValidServerUuid(null)).toBe(false);
    });

    it('rejects undefined', () => {
        expect(isValidServerUuid(undefined)).toBe(false);
    });

    it('rejects an empty string', () => {
        expect(isValidServerUuid('')).toBe(false);
    });

    it('rejects a path-traversal payload', () => {
        expect(isValidServerUuid('../../etc/passwd')).toBe(false);
    });

    it('rejects a javascript: URL fragment', () => {
        expect(isValidServerUuid('javascript:alert(1)')).toBe(false);
    });

    it('rejects a protocol-relative host', () => {
        expect(isValidServerUuid('//evil.com')).toBe(false);
    });

    it('rejects a UUID with extra characters', () => {
        expect(isValidServerUuid('a1b2c3d4-e5f6-7890-abcd-ef1234567890extra')).toBe(false);
    });

    it('rejects a UUID with missing segments', () => {
        expect(isValidServerUuid('a1b2c3d4-e5f6-7890-abcd')).toBe(false);
    });
});
