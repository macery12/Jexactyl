import { Download, FolderOpen, PackageOpen } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { m } from '@/i18n';

// Shown when an archive is clicked, instead of silently downloading it. Makes
// the difference between a browsable archive (zip/7z/ddup on a Supercharged
// node) and a download-only one (.tar.gz, .rar, …) explicit, and offers Extract
// as the path to actually usable contents.
export function ArchiveActionModal({
    name,
    openable,
    canExtract,
    open,
    onOpen,
    onExtract,
    onDownload,
    onClose,
}: {
    name: string;
    openable: boolean;
    canExtract: boolean;
    open: boolean;
    onOpen: () => void;
    onExtract: () => void;
    onDownload: () => void;
    onClose: () => void;
}) {
    const run = (fn: () => void) => () => {
        fn();
        onClose();
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={name}
            size="sm"
            description={
                openable
                    ? m['server.files.archiveMenu.openableHint']()
                    : m['server.files.archiveMenu.downloadOnlyHint']()
            }
        >
            <div className="flex flex-col gap-2">
                {openable && (
                    <Button className="w-full" onClick={run(onOpen)}>
                        <PackageOpen className="h-4 w-4" />
                        {m['server.files.archiveMenu.open']()}
                    </Button>
                )}
                {canExtract && (
                    <Button variant="outline" className="w-full" onClick={run(onExtract)}>
                        <FolderOpen className="h-4 w-4" />
                        {m['server.files.extract']()}
                    </Button>
                )}
                <Button
                    variant={openable ? 'outline' : undefined}
                    className="w-full"
                    onClick={run(onDownload)}
                >
                    <Download className="h-4 w-4" />
                    {m['server.files.download']()}
                </Button>
            </div>
        </Modal>
    );
}
