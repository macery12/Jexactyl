import { useState } from 'react';
import { Dialog } from '@/elements/dialog';
import { Button } from '@/elements/button';
import { ServerContext } from '@/state/server';
import { searchFiles, SearchResult } from '@/api/routes/server/wingsRs';
import useFlash from '@/plugins/useFlash';
import Label from '@/elements/Label';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFile, faFolder, faSearch } from '@fortawesome/free-solid-svg-icons';
import { useNavigate } from 'react-router-dom';

interface Props {
    open: boolean;
    onClose: () => void;
}

const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export default ({ open, onClose }: Props) => {
    const [pattern, setPattern] = useState('');
    const [useGlob, setUseGlob] = useState(true);
    const [useRegex, setUseRegex] = useState(false);
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState<SearchResult[]>([]);
    const [searched, setSearched] = useState(false);

    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const directory = ServerContext.useStoreState(state => state.files.directory);
    const { clearAndAddHttpError, clearFlashes } = useFlash();
    const navigate = useNavigate();
    const id = ServerContext.useStoreState(state => state.server.data!.id);

    const handleSearch = () => {
        if (!pattern.trim()) return;
        clearFlashes('files');
        setLoading(true);
        setSearched(true);

        searchFiles(uuid, {
            root: directory,
            pattern,
            glob: useGlob,
            regex: useRegex,
            case_sensitive: caseSensitive,
        })
            .then(data => {
                setResults(data);
                setLoading(false);
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'files', error });
                setLoading(false);
            });
    };

    const navigateToFile = (result: SearchResult) => {
        const dir = result.is_file ? result.path.substring(0, result.path.lastIndexOf('/')) || '/' : result.path;
        onClose();
        navigate(`/server/${id}/files#${encodeURIComponent(dir)}`);
    };

    return (
        <Dialog open={open} onClose={onClose} title={'Advanced File Search'} size={'lg'}>
            <div className={'mt-4 space-y-4'}>
                <div>
                    <Label>Search Pattern</Label>
                    <div className={'mt-1 flex gap-2'}>
                        <input
                            type={'text'}
                            value={pattern}
                            onChange={e => setPattern(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSearch()}
                            placeholder={useGlob ? '*.log' : useRegex ? '\\.(log|txt)$' : 'filename'}
                            className={
                                'flex-1 rounded border border-gray-700 bg-black/50 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none'
                            }
                        />
                        <Button onClick={handleSearch} disabled={loading || !pattern.trim()}>
                            <FontAwesomeIcon icon={faSearch} className={'mr-1'} />
                            {loading ? 'Searching...' : 'Search'}
                        </Button>
                    </div>
                </div>

                <div className={'flex gap-4'}>
                    <label className={'flex items-center gap-2 text-sm text-gray-400'}>
                        <input
                            type={'checkbox'}
                            checked={useGlob}
                            onChange={e => {
                                setUseGlob(e.target.checked);
                                if (e.target.checked) setUseRegex(false);
                            }}
                            className={'rounded'}
                        />
                        Glob pattern
                    </label>
                    <label className={'flex items-center gap-2 text-sm text-gray-400'}>
                        <input
                            type={'checkbox'}
                            checked={useRegex}
                            onChange={e => {
                                setUseRegex(e.target.checked);
                                if (e.target.checked) setUseGlob(false);
                            }}
                            className={'rounded'}
                        />
                        Regex
                    </label>
                    <label className={'flex items-center gap-2 text-sm text-gray-400'}>
                        <input
                            type={'checkbox'}
                            checked={caseSensitive}
                            onChange={e => setCaseSensitive(e.target.checked)}
                            className={'rounded'}
                        />
                        Case sensitive
                    </label>
                </div>

                {searched && (
                    <div className={'max-h-[400px] overflow-y-auto rounded bg-black/30'}>
                        {results.length === 0 ? (
                            <p className={'p-4 text-center text-gray-500'}>
                                {loading ? 'Searching...' : 'No files found matching your search.'}
                            </p>
                        ) : (
                            <div className={'divide-y divide-gray-800'}>
                                <div className={'px-3 py-2 text-xs text-gray-500'}>
                                    {results.length} result{results.length !== 1 ? 's' : ''} found
                                </div>
                                {results.map((result, i) => (
                                    <div
                                        key={i}
                                        onClick={() => navigateToFile(result)}
                                        className={
                                            'flex cursor-pointer items-center gap-3 px-3 py-2 transition hover:bg-white/5'
                                        }
                                    >
                                        <FontAwesomeIcon
                                            icon={result.is_file ? faFile : faFolder}
                                            className={result.is_file ? 'text-gray-400' : 'text-blue-400'}
                                        />
                                        <div className={'min-w-0 flex-1'}>
                                            <p className={'truncate font-mono text-sm text-gray-200'}>
                                                {result.path}/{result.name}
                                            </p>
                                            <p className={'text-xs text-gray-500'}>
                                                {formatBytes(result.size)}
                                                {result.modified && ` · ${new Date(result.modified).toLocaleString()}`}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </Dialog>
    );
};
