import { useState } from 'react';
import { Dialog } from '@/elements/dialog';
import { Button } from '@/elements/button';
import { ServerContext } from '@/state/server';
import { getFingerprints, FileFingerprint } from '@/api/routes/server/wingsRs';
import useFlash from '@/plugins/useFlash';
import Label from '@/elements/Label';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFingerprint, faCopy } from '@fortawesome/free-solid-svg-icons';

const ALGORITHMS = [
    { value: 'sha256', label: 'SHA-256' },
    { value: 'sha1', label: 'SHA-1' },
    { value: 'md5', label: 'MD5' },
    { value: 'blake3', label: 'BLAKE3' },
];

interface Props {
    open: boolean;
    onClose: () => void;
    files: string[];
    directory: string;
}

export default ({ open, onClose, files, directory }: Props) => {
    const [algorithm, setAlgorithm] = useState('sha256');
    const [loading, setLoading] = useState(false);
    const [fingerprints, setFingerprints] = useState<FileFingerprint[]>([]);
    const [computed, setComputed] = useState(false);

    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const { clearAndAddHttpError, clearFlashes } = useFlash();

    const handleCompute = () => {
        clearFlashes('files');
        setLoading(true);

        getFingerprints(uuid, directory, files, algorithm)
            .then(data => {
                setFingerprints(data);
                setComputed(true);
                setLoading(false);
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'files', error });
                setLoading(false);
            });
    };

    const copyHash = (hash: string) => {
        navigator.clipboard.writeText(hash);
    };

    return (
        <Dialog open={open} onClose={onClose} title={'File Checksums'} size={'lg'}>
            <div className={'mt-4 space-y-4'}>
                <div>
                    <Label>Hash Algorithm</Label>
                    <div className={'mt-1 flex gap-2'}>
                        {ALGORITHMS.map(algo => (
                            <button
                                key={algo.value}
                                onClick={() => {
                                    setAlgorithm(algo.value);
                                    setComputed(false);
                                }}
                                className={`rounded-lg border px-3 py-2 text-sm transition ${
                                    algorithm === algo.value
                                        ? 'border-blue-500 bg-blue-500/10 text-blue-300'
                                        : 'border-gray-700 text-gray-400 hover:border-gray-500'
                                }`}
                            >
                                {algo.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className={'text-xs text-gray-500'}>
                    Computing checksums for {files.length} file{files.length !== 1 ? 's' : ''}
                </div>

                {!computed ? (
                    <Button onClick={handleCompute} disabled={loading}>
                        <FontAwesomeIcon icon={faFingerprint} className={'mr-1'} />
                        {loading ? 'Computing...' : 'Compute Checksums'}
                    </Button>
                ) : (
                    <div className={'max-h-[400px] space-y-2 overflow-y-auto'}>
                        {fingerprints.map((fp, i) => (
                            <div key={i} className={'rounded bg-black/30 p-3'}>
                                <div className={'flex items-center justify-between'}>
                                    <p className={'truncate font-mono text-sm text-gray-300'}>{fp.path}</p>
                                    <button
                                        onClick={() => copyHash(fp.hash)}
                                        className={'ml-2 text-gray-500 hover:text-gray-300'}
                                        title={'Copy hash'}
                                    >
                                        <FontAwesomeIcon icon={faCopy} size={'sm'} />
                                    </button>
                                </div>
                                <p className={'mt-1 break-all font-mono text-xs text-gray-500'}>{fp.hash}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Dialog>
    );
};
