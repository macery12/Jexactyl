import { useEffect, useState } from 'react';
import { ServerContext } from '@/state/server';
import { reinstallServer } from '@/api/routes/server';
import { Actions, useStoreActions } from 'easy-peasy';
import { ApplicationStore } from '@/state';
import { httpErrorToHuman } from '@/api/http';
import tw from 'twin.macro';
import { Button } from '@/elements/button/index';
import { Dialog } from '@/elements/dialog';

export default () => {
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const [modalVisible, setModalVisible] = useState(false);
    const { addFlash, clearFlashes } = useStoreActions((actions: Actions<ApplicationStore>) => actions.flashes);

    const reinstall = () => {
        clearFlashes('settings');
        reinstallServer(uuid)
            .then(() => {
                addFlash({
                    key: 'settings',
                    type: 'success',
                    message: 'Your server has begun the reinstallation process.',
                });
            })
            .catch(error => {
                console.error(error);

                addFlash({ key: 'settings', type: 'error', message: httpErrorToHuman(error) });
            })
            .then(() => setModalVisible(false));
    };

    useEffect(() => {
        clearFlashes();
    }, []);

    return (
        <>
            <Dialog.Confirm
                open={modalVisible}
                title={'Confirm server reinstallation'}
                confirm={'Yes, reinstall server'}
                onClose={() => setModalVisible(false)}
                onConfirmed={reinstall}
            >
                <div css={tw`text-sm rounded-lg p-4 bg-yellow-500/25 mb-4`}>
                    <p css={tw`font-bold text-yellow-300 mb-2`}>⚠️ BACKUP YOUR FILES FIRST</p>
                    <p>
                        Reinstalling your server will stop it, and then re-run the installation script that initially
                        set it up.
                    </p>
                    <p css={tw`mt-2`}>
                        <strong css={tw`font-medium`}>
                            Files are normally NOT deleted during reinstallation, but corruption or modification is
                            always possible. Please backup your data before continuing.
                        </strong>
                    </p>
                </div>
                Your server will be stopped and the installation script will be re-run. Are you sure you wish to
                continue?
            </Dialog.Confirm>
            <Button.Danger type={'button'} variant={Button.Variants.Secondary} onClick={() => setModalVisible(true)}>
                Reinstall Server
            </Button.Danger>
        </>
    );
};
