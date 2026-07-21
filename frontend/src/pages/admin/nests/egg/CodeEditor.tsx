import { useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { type Extension } from '@codemirror/state';
import { languages } from '@codemirror/language-data';

// Themed CodeMirror wrapper — the config JSON and shell install-script editors
// in the egg editor share it. Follows the V2 tokens so it tracks light/dark,
// mirroring the file-manager editor's chrome.
const themeExtension = EditorView.theme({
    '&': {
        backgroundColor: 'var(--color-surface-2)',
        color: 'var(--color-ink)',
        fontSize: '13px',
        borderRadius: 'var(--radius-card)',
    },
    '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
    '.cm-gutters': {
        backgroundColor: 'var(--color-surface)',
        color: 'var(--color-ink-faint)',
        border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'var(--color-surface)' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--color-surface)' },
    '.cm-cursor': { borderLeftColor: 'var(--color-ink)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: 'var(--brand-soft)',
    },
    '.cm-scroller': { overflow: 'auto' },
});

export function CodeEditor({
    value,
    onChange,
    language,
    height = '16rem',
    readOnly = false,
}: {
    value: string;
    onChange?: (next: string) => void;
    language: 'JSON' | 'Shell';
    height?: string;
    readOnly?: boolean;
}) {
    const [langExt, setLangExt] = useState<Extension | null>(null);

    useEffect(() => {
        let active = true;
        const desc = languages.find(l => l.name === language);
        desc?.load().then(support => {
            if (active) setLangExt(support);
        });
        return () => {
            active = false;
        };
    }, [language]);

    const extensions = useMemo(
        () => (langExt ? [themeExtension, langExt] : [themeExtension]),
        [langExt],
    );

    return (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)]">
            <CodeMirror
                value={value}
                height={height}
                theme="none"
                extensions={extensions}
                editable={!readOnly}
                onChange={onChange}
                basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly }}
            />
        </div>
    );
}
