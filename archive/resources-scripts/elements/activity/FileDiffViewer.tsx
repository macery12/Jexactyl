import { useState } from 'react';
import classNames from 'classnames';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/solid';

interface DiffChange {
    type: 'addition' | 'deletion' | 'context';
    content: string;
}

interface DiffHunk {
    old_start: number;
    old_lines: number;
    new_start: number;
    new_lines: number;
    context: string;
    changes: DiffChange[];
}

export interface FileDiff {
    file?: string;
    additions: number;
    deletions: number;
    hunks: DiffHunk[];
    is_new_file?: boolean;
    large_file?: boolean;
}

interface Props {
    diff: FileDiff;
    filename?: string;
    className?: string;
}

const DiffStats = ({ additions, deletions }: { additions: number; deletions: number }) => (
    <div className="flex items-center gap-2 text-sm">
        <span className="text-green-400 font-mono">+{additions}</span>
        <span className="text-red-400 font-mono">-{deletions}</span>
    </div>
);

interface DiffLineProps {
    change: DiffChange;
    lineNumber?: number;
}

const DiffLine = ({ change, lineNumber }: DiffLineProps) => {
    const getBgColor = () => {
        switch (change.type) {
            case 'addition':
                return 'bg-green-900/30 border-l-2 border-green-500';
            case 'deletion':
                return 'bg-red-900/30 border-l-2 border-red-500';
            default:
                return 'bg-transparent border-l-2 border-transparent';
        }
    };

    const getLinePrefix = () => {
        switch (change.type) {
            case 'addition':
                return '+';
            case 'deletion':
                return '-';
            default:
                return ' ';
        }
    };

    return (
        <div className={classNames('flex', getBgColor())}>
            <span className="w-12 px-2 text-right text-slate-500 text-xs font-mono select-none border-r border-slate-700">
                {lineNumber ?? ''}
            </span>
            <span
                className={classNames(
                    'w-6 text-center text-xs font-mono select-none',
                    change.type === 'addition' && 'text-green-400',
                    change.type === 'deletion' && 'text-red-400',
                    change.type === 'context' && 'text-slate-500',
                )}
            >
                {getLinePrefix()}
            </span>
            <pre className="flex-1 text-xs font-mono px-2 whitespace-pre-wrap break-all text-slate-300">
                {change.content || '\u00A0'}
            </pre>
        </div>
    );
};

const DiffHunkView = ({ hunk, index }: { hunk: DiffHunk; index: number }) => {
    const [expanded, setExpanded] = useState(true);

    let oldLineNum = hunk.old_start;
    let newLineNum = hunk.new_start;

    return (
        <div className="border border-slate-700 rounded mb-2 overflow-hidden">
            <button
                className="w-full flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-sm text-slate-400 font-mono"
                onClick={() => setExpanded(!expanded)}
            >
                {expanded ? <ChevronDownIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
                <span>
                    @@ -{hunk.old_start},{hunk.old_lines} +{hunk.new_start},{hunk.new_lines} @@
                </span>
                {hunk.context && <span className="text-slate-500 truncate">{hunk.context}</span>}
            </button>

            {expanded && (
                <div className="bg-slate-900">
                    {hunk.changes.map((change, idx) => {
                        let lineNum: number | undefined;

                        if (change.type === 'deletion') {
                            lineNum = oldLineNum++;
                        } else if (change.type === 'addition') {
                            lineNum = newLineNum++;
                        } else {
                            lineNum = newLineNum++;
                            oldLineNum++;
                        }

                        return <DiffLine key={`${index}-${idx}`} change={change} lineNumber={lineNum} />;
                    })}
                </div>
            )}
        </div>
    );
};

export default ({ diff, filename, className }: Props) => {
    const [showDiff, setShowDiff] = useState(false);
    const displayFilename = filename || diff.file || 'Unknown file';

    if (diff.large_file) {
        return (
            <div className={classNames('rounded-lg bg-slate-800 p-4', className)}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-slate-300 font-mono truncate">{displayFilename}</span>
                        <DiffStats additions={diff.additions} deletions={diff.deletions} />
                    </div>
                    <span className="text-xs text-slate-500">File too large for detailed diff</span>
                </div>
            </div>
        );
    }

    if (!diff.hunks || diff.hunks.length === 0) {
        return (
            <div className={classNames('rounded-lg bg-slate-800 p-4', className)}>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-slate-300 font-mono truncate">{displayFilename}</span>
                        {diff.is_new_file ? (
                            <span className="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded">New file</span>
                        ) : (
                            <DiffStats additions={diff.additions} deletions={diff.deletions} />
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={classNames('rounded-lg bg-slate-800 overflow-hidden', className)}>
            <button
                className="w-full flex items-center justify-between p-3 hover:bg-slate-700 transition-colors"
                onClick={() => setShowDiff(!showDiff)}
            >
                <div className="flex items-center gap-3">
                    {showDiff ? (
                        <ChevronDownIcon className="h-5 w-5 text-slate-400" />
                    ) : (
                        <ChevronRightIcon className="h-5 w-5 text-slate-400" />
                    )}
                    <span className="text-sm text-slate-300 font-mono truncate">{displayFilename}</span>
                    {diff.is_new_file && (
                        <span className="text-xs text-green-400 bg-green-900/30 px-2 py-0.5 rounded">New file</span>
                    )}
                </div>
                <DiffStats additions={diff.additions} deletions={diff.deletions} />
            </button>

            {showDiff && (
                <div className="border-t border-slate-700 p-3">
                    {diff.hunks.map((hunk, index) => (
                        <DiffHunkView key={index} hunk={hunk} index={index} />
                    ))}
                </div>
            )}
        </div>
    );
};
