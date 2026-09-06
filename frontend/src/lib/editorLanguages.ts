import { StreamLanguage } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

export interface EditorLanguage {
    name: string;
    extensions?: readonly string[];
    filenames?: readonly RegExp[];
    load: () => Promise<Extension>;
}

// Keep this list deliberately small. @codemirror/language-data registers more
// than a hundred grammars, which made every one of those loaders a production
// chunk even though a game panel mostly edits JSON, YAML and server configs.
export const EDITOR_LANGUAGES: readonly EditorLanguage[] = [
    {
        name: 'JSON',
        extensions: ['json', 'mcmeta'],
        load: () => import('@codemirror/lang-json').then(module => module.json()),
    },
    {
        name: 'JSON5',
        extensions: ['json5'],
        load: () => import('@codemirror/lang-javascript').then(module => module.javascript()),
    },
    {
        name: 'YAML',
        extensions: ['yaml', 'yml'],
        load: () => import('@codemirror/lang-yaml').then(module => module.yaml()),
    },
    {
        name: 'JavaScript',
        extensions: ['js', 'mjs', 'cjs', 'jsx'],
        load: () => import('@codemirror/lang-javascript').then(module => module.javascript({ jsx: true })),
    },
    {
        name: 'TypeScript',
        extensions: ['ts', 'mts', 'cts', 'tsx'],
        load: () =>
            import('@codemirror/lang-javascript').then(module => module.javascript({ jsx: true, typescript: true })),
    },
    {
        name: 'Shell',
        extensions: ['sh', 'bash', 'zsh'],
        filenames: [/^\.bashrc$/i, /^\.zshrc$/i],
        load: () =>
            import('@codemirror/legacy-modes/mode/shell').then(module => StreamLanguage.define(module.shell)),
    },
    {
        name: 'PHP',
        extensions: ['php', 'phtml'],
        load: () => import('@codemirror/lang-php').then(module => module.php()),
    },
    {
        name: 'Python',
        extensions: ['py', 'pyw'],
        load: () => import('@codemirror/lang-python').then(module => module.python()),
    },
    {
        name: 'SQL',
        extensions: ['sql'],
        load: () => import('@codemirror/lang-sql').then(module => module.sql()),
    },
    {
        name: 'XML',
        extensions: ['xml', 'xsd', 'svg'],
        load: () => import('@codemirror/lang-xml').then(module => module.xml()),
    },
    {
        name: 'HTML',
        extensions: ['html', 'htm'],
        load: () => import('@codemirror/lang-html').then(module => module.html()),
    },
    {
        name: 'CSS',
        extensions: ['css'],
        load: () => import('@codemirror/lang-css').then(module => module.css()),
    },
    {
        name: 'Properties / INI',
        extensions: ['properties', 'ini', 'cfg', 'conf', 'env'],
        filenames: [/^\.env(?:\..+)?$/i],
        load: () =>
            import('@codemirror/legacy-modes/mode/properties').then(module =>
                StreamLanguage.define(module.properties),
            ),
    },
    {
        name: 'TOML',
        extensions: ['toml'],
        load: () => import('@codemirror/legacy-modes/mode/toml').then(module => StreamLanguage.define(module.toml)),
    },
    {
        name: 'Dockerfile',
        filenames: [/^(?:containerfile|dockerfile)(?:\..+)?$/i],
        load: () =>
            import('@codemirror/legacy-modes/mode/dockerfile').then(module =>
                StreamLanguage.define(module.dockerFile),
            ),
    },
    {
        name: 'Nginx',
        filenames: [/^nginx\.conf$/i],
        load: () =>
            import('@codemirror/legacy-modes/mode/nginx').then(module => StreamLanguage.define(module.nginx)),
    },
];

export function findEditorLanguage(name: string): EditorLanguage | undefined {
    return EDITOR_LANGUAGES.find(language => language.name === name);
}

export function matchEditorLanguage(filename: string): EditorLanguage | undefined {
    const basename = filename.split('/').pop() ?? filename;
    const extension = basename.includes('.') ? basename.split('.').pop()?.toLowerCase() : undefined;

    // Exact filename conventions are more specific than a generic extension:
    // nginx.conf should select Nginx even though .conf is also a properties file.
    return (
        EDITOR_LANGUAGES.find(language => language.filenames?.some(pattern => pattern.test(basename))) ??
        EDITOR_LANGUAGES.find(language => Boolean(extension && language.extensions?.includes(extension)))
    );
}

export async function loadEditorLanguage(name: string): Promise<Extension | null> {
    return (await findEditorLanguage(name)?.load()) ?? null;
}

// Egg editors use a fixed language and benefit from the same curated loaders.
export async function loadRequiredEditorLanguage(name: 'JSON' | 'Shell'): Promise<Extension> {
    const language = findEditorLanguage(name);
    if (!language) throw new Error(`Required editor language ${name} is not registered.`);
    return language.load();
}
