import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { m } from '@/i18n/messages';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { exportEgg } from '@/api/adminNests';
import { CodeEditor } from './CodeEditor';

export function ExportEggModal({ eggId, onClose }: { eggId: number; onClose: () => void }) {
    const push = useFlashes(s => s.push);
    const [content, setContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setLoading(true);
        exportEgg(eggId)
            .then(json => active && setContent(json))
            .catch(err => active && push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [eggId, push]);

    const download = () => {
        if (!content) return;
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `egg-${eggId}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={m['admin.nests.egg.export.title']()}
            description={m['admin.nests.egg.export.desc']()}
            size="lg"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        {m['common.actions.close']()}
                    </Button>
                    <Button size="sm" onClick={download} disabled={!content}>
                        <Download className="h-4 w-4" /> {m['admin.nests.egg.export.download']()}
                    </Button>
                </>
            }
        >
            {loading ? (
                <div className="flex items-center justify-center py-16">
                    <Spinner className="h-6 w-6" />
                </div>
            ) : (
                <CodeEditor value={content ?? ''} language="JSON" height="24rem" readOnly />
            )}
        </Modal>
    );
}
