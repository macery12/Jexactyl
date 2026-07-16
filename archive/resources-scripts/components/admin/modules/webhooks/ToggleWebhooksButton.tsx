import { useStoreState } from '@/state/hooks';
import { Button } from '@/elements/button';
import { update } from '@/api/routes/admin/webhooks';
import { useNavigate } from 'react-router-dom';

interface Props {
    fullWidth?: boolean;
}

export default ({ fullWidth = false }: Props) => {
    const navigate = useNavigate();
    const enabled = useStoreState(state => state.everest.data!.webhooks.enabled);

    const submit = () => {
        update('enabled', !enabled).then(() => navigate(0));
    };

    return (
        <div className={fullWidth ? 'w-full' : 'mr-4'} onClick={submit}>
            {!enabled ? (
                <Button className={fullWidth ? 'w-full' : ''}>Enable Webhooks</Button>
            ) : (
                <Button.Danger className={fullWidth ? 'w-full' : ''}>Disable Webhooks</Button.Danger>
            )}
        </div>
    );
};
