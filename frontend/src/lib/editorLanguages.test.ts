import { describe, expect, it } from 'vitest';
import { EDITOR_LANGUAGES, loadRequiredEditorLanguage, matchEditorLanguage } from './editorLanguages';

describe('curated editor languages', () => {
    it.each([
        ['server.properties', 'Properties / INI'],
        ['config/paper-global.yml', 'YAML'],
        ['plugins/example/config.json', 'JSON'],
        ['scripts/start.sh', 'Shell'],
        ['src/index.ts', 'TypeScript'],
        ['Dockerfile', 'Dockerfile'],
        ['nginx.conf', 'Nginx'],
        ['.env.production', 'Properties / INI'],
    ])('matches %s as %s', (filename, expected) => {
        expect(matchEditorLanguage(filename)?.name).toBe(expected);
    });

    it('falls back to plain text for an unknown filename', () => {
        expect(matchEditorLanguage('world/region/r.0.0.mca')).toBeUndefined();
    });

    it('keeps the selectable list intentionally bounded', () => {
        expect(EDITOR_LANGUAGES.length).toBeLessThanOrEqual(20);
    });

    it('loads grammars required by the egg editor', async () => {
        await expect(loadRequiredEditorLanguage('JSON')).resolves.toBeTruthy();
        await expect(loadRequiredEditorLanguage('Shell')).resolves.toBeTruthy();
    });
});
