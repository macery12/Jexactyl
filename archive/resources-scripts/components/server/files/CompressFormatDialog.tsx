import { useState } from 'react';
import { Dialog } from '@/elements/dialog';
import { Button } from '@/elements/button';
import { ServerContext } from '@/state/server';
import { compressAdvanced, ArchiveFormat } from '@/api/routes/server/wingsRs';
import useFlash from '@/plugins/useFlash';
import useFileManagerSwr from '@/plugins/useFileManagerSwr';
import Label from '@/elements/Label';

const FORMATS: { value: ArchiveFormat; label: string; description: string }[] = [
    { value: 'tar_gz', label: '.tar.gz', description: 'Gzip compressed tar (default)' },
    { value: 'tar_zstd', label: '.tar.zst', description: 'Zstandard compressed tar (fast)' },
    { value: 'tar_lz4', label: '.tar.lz4', description: 'LZ4 compressed tar (fastest)' },
    { value: 'tar_xz', label: '.tar.xz', description: 'XZ compressed tar (best ratio)' },
    { value: 'tar_bz2', label: '.tar.bz2', description: 'Bzip2 compressed tar' },
    { value: 'zip', label: '.zip', description: 'ZIP archive' },
    { value: 'seven_zip', label: '.7z', description: '7-Zip archive (best compression)' },
    { value: 'tar', label: '.tar', description: 'Uncompressed tar' },
];

interface Props {
    open: boolean;
    onClose: () => void;
    files: string[];
    directory: string;
}

export default ({ open, onClose, files, directory }: Props) => {
    const [format, setFormat] = useState<ArchiveFormat>('tar_gz');
    const [name, setName] = useState('');
    const [loading, setLoading] = useState(false);

    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const { mutate } = useFileManagerSwr();
    const { clearAndAddHttpError, clearFlashes } = useFlash();

    const handleCompress = () => {
        clearFlashes('files');
        setLoading(true);

        compressAdvanced(uuid, {
            root: directory,
            files,
            format,
            name: name || undefined,
        })
            .then(() => {
                mutate();
                onClose();
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'files', error });
            })
            .finally(() => setLoading(false));
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            title={'Advanced Compression'}
            description={'Choose archive format and options for Wings-RS enhanced compression.'}
        >
            <div className={'mt-4 space-y-4'}>
                <div>
                    <Label>Archive Format</Label>
                    <div className={'mt-1 grid grid-cols-2 gap-2'}>
                        {FORMATS.map(f => (
                            <button
                                key={f.value}
                                onClick={() => setFormat(f.value)}
                                className={`rounded-lg border p-3 text-left transition ${
                                    format === f.value
                                        ? 'border-blue-500 bg-blue-500/10'
                                        : 'border-gray-700 bg-black/30 hover:border-gray-500'
                                }`}
                            >
                                <p className={'font-mono text-sm font-medium text-gray-200'}>{f.label}</p>
                                <p className={'text-xs text-gray-500'}>{f.description}</p>
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <Label>Archive Name (optional)</Label>
                    <input
                        type={'text'}
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder={'auto-generated'}
                        className={
                            'mt-1 w-full rounded border border-gray-700 bg-black/50 px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none'
                        }
                    />
                </div>
                <div className={'text-xs text-gray-500'}>
                    Compressing {files.length} file{files.length !== 1 ? 's' : ''} from{' '}
                    <span className={'font-mono'}>{directory || '/'}</span>
                </div>
            </div>
            <Dialog.Footer>
                <Button onClick={onClose} className={'mr-2'}>
                    Cancel
                </Button>
                <Button onClick={handleCompress} disabled={loading}>
                    {loading ? 'Compressing...' : 'Compress'}
                </Button>
            </Dialog.Footer>
        </Dialog>
    );
};
