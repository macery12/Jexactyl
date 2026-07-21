import { useCallback, useEffect, useRef, useState } from 'react';
import {
    getEmailTemplates,
    getEmailTemplateSource,
    previewEmailTemplate,
    revertEmailTemplate,
    saveEmailTemplateSource,
    type EmailTemplate,
    type TemplateVariable,
} from '@/api/routes/admin/email';
import useFlash from '@/plugins/useFlash';
import Spinner from '@/elements/Spinner';
import { useStoreState } from '@/state/hooks';
import tw from 'twin.macro';
import styled from 'styled-components';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faEnvelopeOpenText,
    faRedo,
    faSave,
    faChevronDown,
    faChevronUp,
    faCheck,
    faExclamationTriangle,
    faCode,
    faEye,
    faTableColumns,
    faRotateLeft,
} from '@fortawesome/free-solid-svg-icons';
import { LanguageDescription } from '@codemirror/language';
import { html } from '@codemirror/lang-html';
import { Editor } from '@/elements/editor';

type ViewMode = 'split' | 'editor' | 'preview';

const VIEW_MODE_KEY = 'email_template_editor_view_mode';

function readStoredViewMode(): ViewMode {
    try {
        const stored = localStorage.getItem(VIEW_MODE_KEY);
        if (stored === 'editor' || stored === 'preview' || stored === 'split') return stored;
    } catch {
        // ignore
    }
    return 'split';
}

// ─── Styled components ────────────────────────────────────────────────────────

const Root = styled.div`
    ${tw`flex flex-col overflow-hidden`}
    height: 720px;
`;

// Top toolbar: view mode toggles + template name + action buttons
const Toolbar = styled.div`
    ${tw`flex items-center justify-between px-3 py-1.5 border border-neutral-700 rounded-t-lg text-xs`}
    background-color: rgba(255, 255, 255, 0.04);
    border-bottom: 0;
`;

const ToolbarLeft = styled.div`
    ${tw`flex items-center gap-3`}
`;

const ToolbarRight = styled.div`
    ${tw`flex items-center gap-2`}
`;

const TemplateName = styled.span`
    ${tw`font-medium`}
    color: #e5e7eb;
    & > span {
        ${tw`ml-1.5 font-normal`}
        color: #6b7280;
    }
`;

// View mode toggle group
const ViewToggleGroup = styled.div`
    ${tw`flex rounded overflow-hidden`}
    border: 1px solid rgba(255,255,255,0.1);
`;

const ViewToggleBtn = styled.button<{ $active: boolean }>`
    ${tw`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-colors`}
    background-color: ${({ $active }) => ($active ? 'rgba(255,255,255,0.14)' : 'transparent')};
    color: ${({ $active }) => ($active ? '#ffffff' : '#9ca3af')};
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    &:last-child {
        border-right: 0;
    }
    &:hover {
        background-color: rgba(255, 255, 255, 0.1);
        color: #ffffff;
    }
`;

const ActionButton = styled.button<{ $variant?: 'primary' | 'danger' }>`
    ${tw`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors`}
    background-color: ${({ $variant }) =>
        $variant === 'primary' ? '#2563eb' : $variant === 'danger' ? '#dc2626' : 'rgba(255,255,255,0.08)'};
    color: #ffffff;
    &:hover {
        background-color: ${({ $variant }) =>
            $variant === 'primary' ? '#1d4ed8' : $variant === 'danger' ? '#b91c1c' : 'rgba(255,255,255,0.14)'};
    }
    &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
`;

const SaveFeedback = styled.span<{ $ok: boolean }>`
    ${tw`flex items-center gap-1.5`}
    color: ${({ $ok }) => ($ok ? '#22c55e' : '#ef4444')};
`;

// Body below toolbar: sidebar + editor pane + preview pane
const Body = styled.div`
    ${tw`flex flex-1 overflow-hidden border border-neutral-700 rounded-b-lg`}
`;

// Left sidebar
const Sidebar = styled.div`
    ${tw`flex-none flex flex-col overflow-y-auto border-r border-neutral-700`}
    width: 200px;
    background-color: rgba(255, 255, 255, 0.02);
`;

const CategoryLabel = styled.div`
    ${tw`text-xs font-semibold uppercase tracking-wider px-3 pt-3 pb-1`}
    color: #6b7280;
`;

const TemplateItem = styled.button<{ $active: boolean; $activeBg: string }>`
    ${tw`w-full text-left px-3 py-2 text-xs transition-colors`}
    background-color: ${({ $active, $activeBg }) => ($active ? $activeBg : 'transparent')};
    color: ${({ $active }) => ($active ? '#ffffff' : '#d1d5db')};
    &:hover {
        background-color: ${({ $active, $activeBg }) => ($active ? $activeBg : 'rgba(255,255,255,0.06)')};
    }
`;

const CustomBadge = styled.span`
    ${tw`inline-block rounded px-1 ml-1.5`}
    font-size: 0.6rem;
    line-height: 1.4;
    background-color: rgba(37, 99, 235, 0.25);
    color: #93c5fd;
    vertical-align: middle;
`;

const DefaultBadge = styled.span`
    ${tw`inline-block rounded px-1 ml-1.5`}
    font-size: 0.6rem;
    line-height: 1.4;
    background-color: rgba(75, 85, 99, 0.3);
    color: #9ca3af;
    vertical-align: middle;
`;

// Variable docs footer inside sidebar
const VarsDivider = styled.div`
    ${tw`mt-auto border-t border-neutral-700`}
`;

const VarsPanelHeader = styled.button`
    ${tw`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors`}
    color: #6b7280;
    &:hover {
        color: #9ca3af;
    }
`;

const VarsList = styled.div`
    ${tw`px-3 pb-3 flex flex-col gap-1.5`}
`;

const VarRow = styled.div<{ $required: boolean }>`
    ${tw`rounded p-2 text-xs`}
    background-color: rgba(255, 255, 255, 0.04);
    border-left: 2px solid ${({ $required }) => ($required ? '#2563eb' : '#374151')};
`;

// Center editor pane
const EditorPane = styled.div<{ $hidden: boolean; $full: boolean }>`
    ${tw`flex flex-col overflow-hidden border-r border-neutral-700`}
    flex: ${({ $full }) => ($full ? '1 1 0' : '3 3 0')};
    min-width: 0;
    display: ${({ $hidden }) => ($hidden ? 'none' : 'flex')};
`;

const PaneSubHeader = styled.div`
    ${tw`flex items-center px-3 py-1 border-b border-neutral-700 text-xs font-medium`}
    color: #6b7280;
    background-color: rgba(255, 255, 255, 0.02);
    flex-shrink: 0;
`;

// Right preview pane
const PreviewPane = styled.div<{ $hidden: boolean; $full: boolean }>`
    ${tw`flex flex-col overflow-hidden`}
    flex: ${({ $full }) => ($full ? '1 1 0' : '7 7 0')};
    min-width: 0;
    display: ${({ $hidden }) => ($hidden ? 'none' : 'flex')};
`;

const StyledIframe = styled.iframe`
    ${tw`flex-1 w-full border-0`}
`;

const EmptyPane = styled.div`
    ${tw`flex-1 flex flex-col items-center justify-center gap-3`}
    color: #6b7280;
`;

// ─── HTML language for Blade (HTML + template-like highlighting) ──────────────
const htmlLanguage = LanguageDescription.of({ name: 'html', support: html() });

export default () => {
    const [loading, setLoading] = useState(true);
    const [templates, setTemplates] = useState<EmailTemplate[]>([]);
    const [selected, setSelected] = useState<EmailTemplate | null>(null);

    // View mode (persisted in localStorage)
    const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);

    // Preview state
    const [previewHtml, setPreviewHtml] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    // Editor source state — loaded automatically when a template is selected
    const [sourceContent, setSourceContent] = useState<string | null>(null);
    const [sourceLoading, setSourceLoading] = useState(false);
    const [, setSavedContent] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveStatus, setSaveStatus] = useState<{ ok: boolean; msg: string } | null>(null);
    const [isCustomized, setIsCustomized] = useState(false);
    const [reverting, setReverting] = useState(false);

    // Variable docs panel open/closed
    const [varsOpen, setVarsOpen] = useState(false);

    const { clearFlashes, addFlash } = useFlash();
    const { colors } = useStoreState(state => state.theme.data!);

    // Ref to pull current editor text on demand
    const fetchEditorContent = useRef<null | (() => Promise<string>)>(null);

    // ── Initial load ──────────────────────────────────────────────────────────
    useEffect(() => {
        clearFlashes('email:templates');
        getEmailTemplates()
            .then(({ templates: list }) => {
                setTemplates(list);
                if (list.length > 0) {
                    loadTemplate(list[0]!);
                }
            })
            .catch(() =>
                addFlash({ key: 'email:templates', type: 'error', message: 'Failed to load email templates.' }),
            )
            .finally(() => setLoading(false));
    }, []);

    // ── Load preview + source for a template ─────────────────────────────────
    const loadTemplate = (tpl: EmailTemplate) => {
        setSelected(tpl);
        setSourceContent(null);
        setSavedContent(null);
        setSaveStatus(null);
        setIsCustomized(tpl.is_customized);

        // Load preview
        setPreviewHtml(null);
        setPreviewLoading(true);
        previewEmailTemplate(tpl.key)
            .then(rendered => setPreviewHtml(rendered))
            .catch(() =>
                addFlash({
                    key: 'email:templates',
                    type: 'error',
                    message: `Failed to render preview for "${tpl.label}".`,
                }),
            )
            .finally(() => setPreviewLoading(false));

        // Load source
        setSourceLoading(true);
        getEmailTemplateSource(tpl.key)
            .then(({ content, is_customized }) => {
                setSourceContent(content);
                setSavedContent(content);
                setIsCustomized(is_customized);
            })
            .catch(() =>
                addFlash({
                    key: 'email:templates',
                    type: 'error',
                    message: `Failed to load source for "${tpl.label}".`,
                }),
            )
            .finally(() => setSourceLoading(false));
    };

    const refreshPreview = () => {
        if (!selected) return;
        setPreviewHtml(null);
        setPreviewLoading(true);
        previewEmailTemplate(selected.key)
            .then(rendered => setPreviewHtml(rendered))
            .catch(() => addFlash({ key: 'email:templates', type: 'error', message: 'Failed to refresh preview.' }))
            .finally(() => setPreviewLoading(false));
    };

    const handleSave = useCallback(async () => {
        if (!selected || !fetchEditorContent.current) return;
        const content = await fetchEditorContent.current();
        setSaving(true);
        setSaveStatus(null);
        saveEmailTemplateSource(selected.key, content)
            .then(({ is_customized: customized }) => {
                setSaveStatus({ ok: true, msg: 'Saved.' });
                setSavedContent(content);
                setSourceContent(content);
                setIsCustomized(customized);
                // Update the template list entry so the sidebar badge refreshes
                setTemplates(prev => prev.map(t => (t.key === selected.key ? { ...t, is_customized: customized } : t)));
                // Refresh preview to reflect saved changes
                setPreviewHtml(null);
                setPreviewLoading(true);
                previewEmailTemplate(selected.key)
                    .then(rendered => setPreviewHtml(rendered))
                    .finally(() => setPreviewLoading(false));
            })
            .catch(() => setSaveStatus({ ok: false, msg: 'Save failed — check file permissions.' }))
            .finally(() => setSaving(false));
    }, [selected]);

    const handleRevert = useCallback(() => {
        if (!selected) return;
        setReverting(true);
        setSaveStatus(null);
        revertEmailTemplate(selected.key)
            .then(() => {
                setIsCustomized(false);
                setTemplates(prev => prev.map(t => (t.key === selected.key ? { ...t, is_customized: false } : t)));
                // Reload the default source and refresh preview
                setSourceLoading(true);
                getEmailTemplateSource(selected.key)
                    .then(({ content, is_customized }) => {
                        setSourceContent(content);
                        setSavedContent(content);
                        setIsCustomized(is_customized);
                    })
                    .catch(() =>
                        addFlash({
                            key: 'email:templates',
                            type: 'error',
                            message: 'Failed to reload template source after revert.',
                        }),
                    )
                    .finally(() => setSourceLoading(false));

                setPreviewHtml(null);
                setPreviewLoading(true);
                previewEmailTemplate(selected.key)
                    .then(rendered => setPreviewHtml(rendered))
                    .finally(() => setPreviewLoading(false));

                setSaveStatus({ ok: true, msg: 'Reverted to default.' });
            })
            .catch(() => setSaveStatus({ ok: false, msg: 'Revert failed — check file permissions.' }))
            .finally(() => setReverting(false));
    }, [selected]);

    const switchViewMode = (mode: ViewMode) => {
        setViewMode(mode);
        try {
            localStorage.setItem(VIEW_MODE_KEY, mode);
        } catch {
            /* ignore */
        }
    };

    // ── Derived ───────────────────────────────────────────────────────────────
    const grouped = templates.reduce<Record<string, EmailTemplate[]>>((acc, tpl) => {
        (acc[tpl.category] = acc[tpl.category] ?? []).push(tpl);
        return acc;
    }, {});

    const variables: TemplateVariable[] = selected?.variables ?? [];

    if (loading) {
        return (
            <div css={tw`flex justify-center py-8`}>
                <Spinner size="large" />
            </div>
        );
    }

    const editorHidden = viewMode === 'preview';
    const previewHidden = viewMode === 'editor';
    const editorFull = viewMode === 'editor';
    const previewFull = viewMode === 'preview';

    return (
        <Root>
            {/* ── Toolbar ─────────────────────────────────────────────────── */}
            <Toolbar>
                <ToolbarLeft>
                    {/* View mode toggles */}
                    <ViewToggleGroup>
                        <ViewToggleBtn
                            $active={viewMode === 'split'}
                            onClick={() => switchViewMode('split')}
                            title="Split view"
                        >
                            <FontAwesomeIcon icon={faTableColumns} />
                            Split
                        </ViewToggleBtn>
                        <ViewToggleBtn
                            $active={viewMode === 'editor'}
                            onClick={() => switchViewMode('editor')}
                            title="Editor only"
                        >
                            <FontAwesomeIcon icon={faCode} />
                            Editor
                        </ViewToggleBtn>
                        <ViewToggleBtn
                            $active={viewMode === 'preview'}
                            onClick={() => switchViewMode('preview')}
                            title="Preview only"
                        >
                            <FontAwesomeIcon icon={faEye} />
                            Preview
                        </ViewToggleBtn>
                    </ViewToggleGroup>

                    {/* Template name */}
                    {selected && (
                        <TemplateName>
                            {selected.label}
                            <span>({selected.key})</span>
                            {isCustomized ? <CustomBadge>custom</CustomBadge> : <DefaultBadge>default</DefaultBadge>}
                        </TemplateName>
                    )}
                </ToolbarLeft>

                <ToolbarRight>
                    {/* Save status */}
                    {saveStatus && (
                        <SaveFeedback $ok={saveStatus.ok}>
                            <FontAwesomeIcon icon={saveStatus.ok ? faCheck : faExclamationTriangle} />
                            {saveStatus.msg}
                        </SaveFeedback>
                    )}

                    {/* Revert to default */}
                    {selected && isCustomized && (
                        <ActionButton
                            $variant="danger"
                            onClick={handleRevert}
                            disabled={reverting}
                            title="Revert to default template"
                        >
                            {reverting ? <Spinner size="small" /> : <FontAwesomeIcon icon={faRotateLeft} />}
                            Revert to Default
                        </ActionButton>
                    )}

                    {/* Refresh preview */}
                    {selected && viewMode !== 'editor' && (
                        <ActionButton onClick={refreshPreview} disabled={previewLoading} title="Refresh preview">
                            <FontAwesomeIcon icon={faRedo} />
                            Refresh
                        </ActionButton>
                    )}

                    {/* Save */}
                    {selected && sourceContent !== null && (
                        <ActionButton
                            $variant="primary"
                            onClick={handleSave}
                            disabled={saving}
                            title="Save template (Ctrl+S)"
                        >
                            {saving ? <Spinner size="small" /> : <FontAwesomeIcon icon={faSave} />}
                            Save
                        </ActionButton>
                    )}
                </ToolbarRight>
            </Toolbar>

            {/* ── Body ────────────────────────────────────────────────────── */}
            <Body>
                {/* Left sidebar */}
                <Sidebar>
                    <div css={tw`flex-1 overflow-y-auto`}>
                        {Object.entries(grouped).map(([category, items]) => (
                            <div key={category}>
                                <CategoryLabel>{category}</CategoryLabel>
                                {items.map(tpl => (
                                    <TemplateItem
                                        key={tpl.key}
                                        $active={selected?.key === tpl.key}
                                        $activeBg={colors.primary}
                                        onClick={() => loadTemplate(tpl)}
                                    >
                                        {tpl.label}
                                        {tpl.is_customized && <CustomBadge>custom</CustomBadge>}
                                    </TemplateItem>
                                ))}
                            </div>
                        ))}
                    </div>

                    {/* Variable docs in sidebar */}
                    {variables.length > 0 && (
                        <VarsDivider>
                            <VarsPanelHeader onClick={() => setVarsOpen(v => !v)}>
                                <span>Variables ({variables.length})</span>
                                <FontAwesomeIcon icon={varsOpen ? faChevronUp : faChevronDown} />
                            </VarsPanelHeader>
                            {varsOpen && (
                                <VarsList>
                                    {variables.map(v => (
                                        <VarRow key={v.name} $required={v.required}>
                                            <div css={tw`font-mono font-semibold`} style={{ color: '#93c5fd' }}>
                                                {v.name}
                                                {v.required && (
                                                    <span
                                                        css={tw`ml-1 font-normal`}
                                                        style={{ color: '#60a5fa', fontSize: '0.65rem' }}
                                                    >
                                                        req
                                                    </span>
                                                )}
                                            </div>
                                            <div css={tw`mt-0.5`} style={{ color: '#9ca3af' }}>
                                                {v.description}
                                            </div>
                                            {v.example && (
                                                <div
                                                    css={tw`mt-0.5 font-mono`}
                                                    style={{ color: '#4b5563', fontSize: '0.65rem' }}
                                                >
                                                    e.g. {v.example}
                                                </div>
                                            )}
                                        </VarRow>
                                    ))}
                                </VarsList>
                            )}
                        </VarsDivider>
                    )}
                </Sidebar>

                {/* Center: code editor */}
                <EditorPane $hidden={editorHidden} $full={editorFull}>
                    <PaneSubHeader>
                        <FontAwesomeIcon icon={faCode} css={tw`mr-1.5`} />
                        {selected ? `${selected.key}.blade.php` : 'No template selected'}
                    </PaneSubHeader>

                    {sourceLoading ? (
                        <EmptyPane>
                            <Spinner size="large" />
                        </EmptyPane>
                    ) : sourceContent !== null ? (
                        <div css={tw`flex-1 overflow-auto`}>
                            <Editor
                                initialContent={sourceContent}
                                language={htmlLanguage}
                                fetchContent={cb => {
                                    fetchEditorContent.current = cb;
                                }}
                                onContentSaved={handleSave}
                                style={{ minHeight: '560px' }}
                            />
                        </div>
                    ) : (
                        <EmptyPane>
                            <span css={tw`text-sm`}>Select a template to edit.</span>
                        </EmptyPane>
                    )}
                </EditorPane>

                {/* Right: live preview */}
                <PreviewPane $hidden={previewHidden} $full={previewFull}>
                    <PaneSubHeader>
                        <FontAwesomeIcon icon={faEye} css={tw`mr-1.5`} />
                        Rendered preview
                    </PaneSubHeader>

                    {previewLoading ? (
                        <EmptyPane>
                            <Spinner size="large" />
                        </EmptyPane>
                    ) : previewHtml !== null ? (
                        <StyledIframe
                            srcDoc={previewHtml}
                            title={`Preview: ${selected?.label}`}
                            sandbox="allow-same-origin"
                        />
                    ) : (
                        <EmptyPane>
                            <FontAwesomeIcon icon={faEnvelopeOpenText} size="2x" />
                            <span css={tw`text-sm`}>Select a template to preview it here.</span>
                        </EmptyPane>
                    )}
                </PreviewPane>
            </Body>
        </Root>
    );
};
