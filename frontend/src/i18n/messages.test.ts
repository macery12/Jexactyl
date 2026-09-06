import { describe, expect, it } from 'vitest';
import { compiledMessageName } from './messages';

describe('compiled Paraglide message names', () => {
    it.each([
        ['account.billing.add', 'account_billing_add'],
        ['account.billing.addressLine1', 'account_billing_addressline11'],
        ['admin.ai.settings.maxToolSeconds', 'admin_ai_settings_maxtoolseconds2'],
        ['server.mods.release.1', 'server_mods_release_1'],
    ])('maps %s to %s', (messageId, exportName) => {
        expect(compiledMessageName(messageId)).toBe(exportName);
    });
});
