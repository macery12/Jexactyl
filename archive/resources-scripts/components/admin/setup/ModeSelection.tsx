import PersonalModeSvg from '@/assets/images/themed/PersonalModeSvg';
import StandardMoveSvg from '@/assets/images/themed/StandardMoveSvg';
import { useStoreActions, useStoreState } from '@/state/hooks';
import { Button } from '@/elements/button';
import { PanelMode } from '@/state/settings';
import { updateModeSettings } from '@/api/routes/admin/settings';

export default () => {
    const { mode } = useStoreState(state => state.settings.data!);
    const { primary } = useStoreState(state => state.theme.data!.colors);

    const updateSettings = useStoreActions(actions => actions.settings.updateSettings);

    const updateMode = (mode: PanelMode) => {
        updateModeSettings(mode)
            .then(() => updateSettings({ mode: mode }))
            .catch(e => console.error(e));
    };

    return (
        <div>
            <div className={'mb-8 flex w-full flex-col gap-2 sm:flex-row sm:items-center'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>Mode Selection</h2>
                    <p
                        className={
                            'hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400 lg:block'
                        }
                    >
                        Select how you want to run M12Labs.
                    </p>
                </div>
            </div>
            <div className={'grid gap-8 lg:grid-cols-2'}>
                <div className={'relative w-full rounded-xl bg-black/25 p-8'}>
                    <PersonalModeSvg color={primary} />
                    <p className={'mb-2 text-2xl font-bold lg:text-4xl'}>Personal Mode</p>
                    <p className={'text-gray-400'}>
                        Personal Mode allows you to run M12Labs in standard settings, with basic features enable by
                        default. It gives you all the great typical features of a game hosting panel without any
                        business-oriented features making it a cluttered experience.
                    </p>
                    <div className={'absolute top-0 right-0 p-3'}>
                        <Button.Text disabled={mode === 'personal'} onClick={() => updateMode('personal')}>
                            Select{mode === 'personal' && 'ed'}
                        </Button.Text>
                    </div>
                </div>
                <div className={'relative w-full rounded-xl bg-black/25 p-8'}>
                    <StandardMoveSvg color={primary} />
                    <p className={'mb-2 text-2xl font-bold lg:text-4xl'}>Standard Mode</p>
                    <p className={'text-gray-400'}>
                        Standard Mode allows all of the M12Labs features by default, such as billing, tickets, webhooks
                        and more. It&apos;s ideal for businesses or large groups who need more control over their users.
                    </p>
                    <div className={'absolute top-0 right-0 p-3'}>
                        <Button.Text disabled={mode === 'standard'} onClick={() => updateMode('standard')}>
                            Select{mode === 'standard' && 'ed'}
                        </Button.Text>
                    </div>
                </div>
            </div>
        </div>
    );
};
