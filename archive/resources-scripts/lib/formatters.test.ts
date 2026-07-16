import { describe, expect, it } from 'vitest';
import { bytesToString, mbToBytes } from './formatters';

describe('formatters', () => {
    it('converts megabytes to bytes and formats bytes', () => {
        expect(mbToBytes(1)).toBe(1024 * 1024);
        expect(bytesToString(0)).toBe('0 Bytes');
        expect(bytesToString(1024)).toBe('1 KiB');
    });
});
