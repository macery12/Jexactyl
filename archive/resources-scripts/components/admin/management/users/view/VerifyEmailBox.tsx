import tw from 'twin.macro';
import AdminBox from '@/elements/AdminBox';
import { Button } from '@/elements/button';
import { faEnvelope } from '@fortawesome/free-solid-svg-icons';
import { Dialog } from '@/elements/dialog';
import { useState } from 'react';
import useFlash from '@/plugins/useFlash';
import { Context } from '@admin/management/users/UserRouter';
import { verifyUserEmail } from '@/api/routes/admin/users';

export default () => {
    const { addFlash, clearAndAddHttpError } = useFlash();
    const [visible, setVisible] = useState<boolean>(false);
    const user = Context.useStoreState(state => state.user);
    const setUser = Context.useStoreActions(actions => actions.setUser);

    if (user === undefined) {
        return <></>;
    }

    const isVerified = user.emailVerified;
    const action = isVerified ? 'unverify' : 'verify';

    const submit = () => {
        verifyUserEmail(user.id, !isVerified)
            .then(() => {
                setUser({ ...user, emailVerified: !isVerified });
                addFlash({
                    key: 'user:manage',
                    type: 'success',
                    message: `This user's email has been marked as ${isVerified ? 'unverified' : 'verified'}.`,
                });
            })
            .catch(error => {
                clearAndAddHttpError({
                    key: 'user:manage',
                    error: error,
                });
            });

        setVisible(false);
    };

    return (
        <>
            <Dialog.Confirm
                title={`Confirm email ${action}`}
                onConfirmed={submit}
                open={visible}
                onClose={() => setVisible(false)}
                confirm={'I understand, proceed'}
            >
                Are you sure you wish to manually {action} this user&apos;s email address?
            </Dialog.Confirm>
            <div css={tw`h-auto flex flex-col`}>
                <AdminBox icon={faEnvelope} title={'Email Verification'} css={tw`relative w-full`}>
                    {isVerified ? (
                        <Button.Warn
                            size={Button.Sizes.Large}
                            css={tw`w-full capitalize`}
                            onClick={() => setVisible(true)}
                        >
                            Unverify Email
                        </Button.Warn>
                    ) : (
                        <Button size={Button.Sizes.Large} css={tw`w-full capitalize`} onClick={() => setVisible(true)}>
                            Verify Email
                        </Button>
                    )}
                    <p css={tw`text-xs text-neutral-400 mt-2`}>
                        Email Verified:&nbsp;<strong>{isVerified ? 'true' : 'false'}</strong>. Use this to manually
                        override email verification without sending a verification link.
                    </p>
                </AdminBox>
            </div>
        </>
    );
};
