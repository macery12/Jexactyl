import tw from 'twin.macro';
import { useState } from 'react';
import { Button } from '@/elements/button';
import { faDiscord } from '@fortawesome/free-brands-svg-icons';
import { faCheck, faLink, faUnlink } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { getDiscordLinkUrl, unlinkDiscordAccount } from '@/api/routes/auth/discord';
import useFlash from '@/plugins/useFlash';
import { useStoreActions, useStoreState } from '@/state/hooks';

export default () => {
    const user = useStoreState(s => s.user.data!);
    const updateUserData = useStoreActions(a => a.user.updateUserData);
    const { clearFlashes, clearAndAddHttpError, addFlash } = useFlash();
    const [loading, setLoading] = useState(false);

    const handleLink = () => {
        clearFlashes();
        setLoading(true);

        getDiscordLinkUrl()
            .then(({ url }) => {
                window.location.href = url;
            })
            .catch(error => {
                setLoading(false);
                clearAndAddHttpError({ key: 'account:discord', error });
            });
    };

    const handleUnlink = () => {
        if (
            !confirm(
                'Are you sure you want to unlink your Discord account? You will no longer be able to log in via Discord SSO.',
            )
        ) {
            return;
        }

        clearFlashes();
        setLoading(true);

        unlinkDiscordAccount()
            .then(() => {
                updateUserData({ discordLinked: false });
                addFlash({
                    key: 'account:discord',
                    type: 'success',
                    title: 'Success',
                    message: 'Your Discord account has been unlinked.',
                });
                setLoading(false);
            })
            .catch(error => {
                setLoading(false);
                clearAndAddHttpError({ key: 'account:discord', error });
            });
    };

    return (
        <div>
            <div css={tw`flex items-center justify-between mb-4`}>
                <div css={tw`flex items-center`}>
                    <FontAwesomeIcon icon={faDiscord} css={tw`text-blue-400 mr-2 text-lg`} />
                    <span css={tw`text-sm text-gray-300`}>Discord Account</span>
                </div>
                <div css={tw`flex items-center`}>
                    {user.discordLinked ? (
                        <>
                            <FontAwesomeIcon icon={faCheck} css={tw`text-green-400 mr-1 text-sm`} />
                            <span css={tw`text-sm text-green-400`}>Linked</span>
                        </>
                    ) : (
                        <span css={tw`text-sm text-gray-500`}>Not Linked</span>
                    )}
                </div>
            </div>

            {user.discordLinked ? (
                <div>
                    <p css={tw`text-xs text-gray-400 mb-3`}>
                        Your Discord account is linked. You can log in to the panel using Discord SSO. To remove this
                        connection, click the button below.
                    </p>
                    <Button.Danger
                        type={'button'}
                        size={Button.Sizes.Small}
                        className={'w-full'}
                        disabled={loading}
                        onClick={handleUnlink}
                    >
                        <FontAwesomeIcon icon={faUnlink} css={tw`mr-2`} />
                        Unlink Discord
                    </Button.Danger>
                </div>
            ) : (
                <div>
                    <p css={tw`text-xs text-gray-400 mb-3`}>
                        Link your Discord account to enable Discord SSO login. You will be redirected to Discord to
                        authorize the connection.
                    </p>
                    <Button.Info
                        type={'button'}
                        size={Button.Sizes.Small}
                        className={'w-full'}
                        disabled={loading}
                        onClick={handleLink}
                    >
                        <FontAwesomeIcon icon={faLink} css={tw`mr-2`} />
                        Link Discord Account
                    </Button.Info>
                </div>
            )}
        </div>
    );
};
