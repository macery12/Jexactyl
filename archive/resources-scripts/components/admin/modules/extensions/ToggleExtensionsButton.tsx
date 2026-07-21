import { useState } from 'react';
import { useStoreState } from '@/state/hooks';
import useFlash from '@/plugins/useFlash';
import { Button } from '@/elements/button';
import { updateModuleSettings } from '@/api/routes/admin/extensions';

export default () => {
    const [loading, setLoading] = useState(false);
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();
    const enabled = useStoreState(state => state.everest.data!.extensions?.enabled);

    const toggle = () => {
        setLoading(true);
        clearFlashes('admin:extensions');

        updateModuleSettings(!enabled)
            .then(() => {
                addFlash({
                    key: 'admin:extensions',
                    type: 'success',
                    message: `Extensions module has been ${enabled ? 'disabled' : 'enabled'}.`,
                });
                setTimeout(() => window.location.reload(), 500);
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'admin:extensions', error });
            })
            .finally(() => setLoading(false));
    };

    return (
        <Button onClick={toggle} disabled={loading}>
            {enabled ? 'Disable' : 'Enable'} Extensions Module
        </Button>
    );
};
