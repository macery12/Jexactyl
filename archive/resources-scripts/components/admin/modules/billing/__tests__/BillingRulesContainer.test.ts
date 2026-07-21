import { describe, expect, it } from 'vitest';
import { normalizeBillingDaysValue, normalizeMultiplierValue } from '../BillingRulesContainer';

describe('normalizeMultiplierValue', () => {
    it('accepts values within range with decimals', () => {
        expect(normalizeMultiplierValue('0.1')).toEqual({ value: 0.1, clamped: undefined });
        expect(normalizeMultiplierValue('0.11')).toEqual({ value: 0.11, clamped: undefined });
        expect(normalizeMultiplierValue('1.25')).toEqual({ value: 1.25, clamped: undefined });
        expect(normalizeMultiplierValue('10')).toEqual({ value: 10, clamped: undefined });
    });

    it('rejects empty or non-numeric values', () => {
        expect(() => normalizeMultiplierValue('')).toThrowError();
        expect(() => normalizeMultiplierValue('abc')).toThrowError();
    });

    it('clamps values outside allowed bounds', () => {
        expect(normalizeMultiplierValue('0.02')).toEqual({ value: 0.1, clamped: 'MIN' });
        expect(normalizeMultiplierValue('50')).toEqual({ value: 10, clamped: 'MAX' });
    });
});

describe('normalizeBillingDaysValue', () => {
    it('accepts days within range', () => {
        expect(normalizeBillingDaysValue('1')).toEqual({ value: 1, clamped: undefined });
        expect(normalizeBillingDaysValue('30')).toEqual({ value: 30, clamped: undefined });
        expect(normalizeBillingDaysValue('360')).toEqual({ value: 360, clamped: undefined });
    });

    it('rejects empty or non-numeric values', () => {
        expect(() => normalizeBillingDaysValue('')).toThrowError();
        expect(() => normalizeBillingDaysValue('abc')).toThrowError();
    });

    it('clamps values outside bounds', () => {
        expect(normalizeBillingDaysValue('0')).toEqual({ value: 1, clamped: 'MIN' });
        expect(normalizeBillingDaysValue('400')).toEqual({ value: 360, clamped: 'MAX' });
    });
});
