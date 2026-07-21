import { useState } from 'react';
import useFlash from '@/plugins/useFlash';
import { Button } from '@/elements/button';
import { Dialog } from '@/elements/dialog';
import Preview from '@admin/modules/theme/Preview';
import AdminContentBlock from '@/elements/AdminContentBlock';
import ColorSelect from '@admin/modules/theme/ColorSelect';
import PresetManager from '@admin/modules/theme/PresetManager';
import resetTheme from '@/api/routes/admin/theme/resetTheme';

export default () => {
    const [reload, setReload] = useState<boolean>(false);
    const [visible, setVisible] = useState<boolean>(false);
    const { clearFlashes, clearAndAddHttpError } = useFlash();

    const submit = () => {
        clearFlashes('theme:colors');

        resetTheme()
            .then(() => {
                // @ts-expect-error this is fine
                window.location = '/admin/theme';
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'theme:colors', error });
            });
    };

    return (
        <AdminContentBlock showFlashKey={'theme:colors'}>
            <Dialog.Confirm
                title={'Are you sure?'}
                open={visible}
                onClose={() => setVisible(false)}
                onConfirmed={submit}
            >
                Performing this action will immediately wipe all of your custom theming settings. Only do this if you
                wish to return to the stock appearance of Jexactyl. This action cannot be reversed.
            </Dialog.Confirm>
            <div className={'mb-8 flex w-full flex-col gap-2 sm:flex-row sm:items-center'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>System Theme</h2>
                    <p
                        className={
                            'hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-neutral-400 lg:block'
                        }
                    >
                        View and update the theme of this interface.
                    </p>
                </div>
                <div className={'ml-auto flex pl-4'}>
                    <Button
                        type={'button'}
                        size={Button.Sizes.Large}
                        onClick={() => setVisible(true)}
                        className={'h-10 whitespace-nowrap px-4 py-0'}
                    >
                        Reset to Defaults
                    </Button>
                </div>
            </div>
            <div className={'mb-4'}>
                <PresetManager onApplied={() => setReload(r => !r)} />
            </div>
            <div className={'grid gap-4 md:grid-cols-2 xl:grid-cols-3'}>
                <ColorSelect setReload={setReload} />
                <Preview reload={reload} />
            </div>
        </AdminContentBlock>
    );
};
