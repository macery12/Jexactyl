import { Button } from '@/elements/button';
import { useStoreState } from '@/state/hooks';
import { updateCustomDomainSettings } from '@/api/routes/admin/customDomains';

export default () => {
    const enabled = useStoreState(state => state.everest.data!.custom_domains.enabled);

    const submit = () => {
        updateCustomDomainSettings({ enabled: !enabled }).then(() => {
            // @ts-expect-error this is fine
            window.location = '/admin/custom-domains';
        });
    };

    return (
        <div className={'mr-4'} onClick={submit}>
            {!enabled ? <Button>Enable Custom Domains</Button> : <Button.Danger>Disable Custom Domains</Button.Danger>}
        </div>
    );
};
