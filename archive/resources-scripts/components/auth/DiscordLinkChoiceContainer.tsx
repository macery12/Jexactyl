import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import tw from 'twin.macro';
import styled from 'styled-components';
import { breakpoint } from '@/assets/theme';

import { Button } from '@/elements/button';
import useFlash from '@/plugins/useFlash';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { getDiscordRegistrationData } from '@/api/routes/auth/discord';
import { faDiscord } from '@fortawesome/free-brands-svg-icons';
import { faUserPlus, faLink } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

// Same visual shell as LoginFormContainer but uses a plain <div> — no Formik context needed.
const Container = styled.div<{ isVisible: boolean }>`
    opacity: ${({ isVisible }) => (isVisible ? 1 : 0)};
    transition: opacity 0.5s ease-in;

    ${breakpoint('sm')`
        ${tw`w-4/5 mx-auto`}
    `};

    ${breakpoint('md')`
        ${tw`p-10`}
    `};

    ${breakpoint('lg')`
        ${tw`w-3/5`}
    `};

    ${breakpoint('xl')`
        ${tw`w-full my-auto`}
    `};
`;

function DiscordLinkChoiceContainer() {
    const navigate = useNavigate();
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const [visible, setVisible] = useState(false);
    const [discordData, setDiscordData] = useState<{
        discord_username: string;
        discord_email: string;
        discord_id: string;
    } | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const timeout = setTimeout(() => setVisible(true), 50);
        return () => clearTimeout(timeout);
    }, []);

    useEffect(() => {
        clearFlashes();

        getDiscordRegistrationData()
            .then(data => {
                setDiscordData(data);
                setLoading(false);
            })
            .catch(error => {
                clearAndAddHttpError({ error });
                setTimeout(() => navigate('/auth/login'), 2000);
                setLoading(false);
            });
    }, []);

    if (loading || !discordData) {
        return (
            <Container isVisible={visible}>
                <div className={'grid w-full 2xl:grid-cols-2'}>
                    <div className={'w-full lg:mx-auto lg:w-1/2'}>
                        <h2 css={tw`text-3xl text-center text-neutral-100 font-medium py-4`}>
                            {loading ? 'Loading...' : 'Error'}
                        </h2>
                        <div css={tw`w-full bg-zinc-800/50 shadow-lg rounded-lg p-6 mx-1`}>
                            <div css={tw`text-center py-8`}>
                                {loading ? (
                                    <p css={tw`text-gray-400`}>Loading Discord information...</p>
                                ) : (
                                    <p css={tw`text-red-400`}>Discord session data not found. Redirecting...</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </Container>
        );
    }

    return (
        <Container isVisible={visible}>
            <div className={'grid w-full 2xl:grid-cols-2'}>
                <div className={'w-full lg:mx-auto lg:w-1/2'}>
                    <h2 css={tw`text-3xl text-center text-neutral-100 font-medium py-4`}>Discord Account Not Linked</h2>
                    <FlashMessageRender css={tw`mb-2 px-1`} />
                    <div css={tw`w-full bg-zinc-800/50 shadow-lg rounded-lg p-6 mx-1`}>
                        <div css={tw`mb-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded`}>
                            <div css={tw`flex items-center mb-2`}>
                                <FontAwesomeIcon icon={faDiscord} css={tw`text-blue-400 mr-2`} />
                                <span css={tw`text-sm font-semibold text-blue-400`}>Discord Account</span>
                            </div>
                            <p css={tw`text-xs text-gray-400`}>
                                Discord Username: <span css={tw`text-gray-300`}>{discordData.discord_username}</span>
                            </p>
                            <p css={tw`text-xs text-gray-400`}>
                                Email: <span css={tw`text-gray-300`}>{discordData.discord_email}</span>
                            </p>
                        </div>

                        <p css={tw`text-sm text-gray-300 mb-6`}>
                            No account is linked to this Discord profile. Choose how you would like to proceed:
                        </p>

                        <div css={tw`space-y-4`}>
                            <div css={tw`p-4 bg-zinc-700/50 border border-zinc-600 rounded`}>
                                <div css={tw`flex items-center mb-2`}>
                                    <FontAwesomeIcon icon={faUserPlus} css={tw`text-green-400 mr-2`} />
                                    <span css={tw`text-sm font-semibold text-gray-200`}>Create a New Account</span>
                                </div>
                                <p css={tw`text-xs text-gray-400 mb-3`}>
                                    Register a new panel account linked to your Discord profile. You will need to set a
                                    username and a password for SFTP access.
                                </p>
                                <Button
                                    type={'button'}
                                    className={'w-full'}
                                    size={Button.Sizes.Small}
                                    onClick={() => navigate('/auth/discord/register')}
                                >
                                    Create New Account
                                </Button>
                            </div>

                            <div css={tw`p-4 bg-zinc-700/50 border border-zinc-600 rounded`}>
                                <div css={tw`flex items-center mb-2`}>
                                    <FontAwesomeIcon icon={faLink} css={tw`text-yellow-400 mr-2`} />
                                    <span css={tw`text-sm font-semibold text-gray-200`}>
                                        Link to an Existing Account
                                    </span>
                                </div>
                                <p css={tw`text-xs text-gray-400 mb-3`}>
                                    If you already have an account on this panel, you can link your Discord profile to
                                    it. To do so:
                                </p>
                                <ol css={tw`text-xs text-gray-400 list-decimal list-inside space-y-1 mb-3`}>
                                    <li>Log in to your existing account below.</li>
                                    <li>
                                        Go to your <span css={tw`text-gray-300`}>Account</span> page.
                                    </li>
                                    <li>
                                        Click <span css={tw`text-gray-300`}>Link Discord Account</span> in the Connected
                                        Accounts section.
                                    </li>
                                </ol>
                                <Button.Text
                                    type={'button'}
                                    className={'w-full'}
                                    size={Button.Sizes.Small}
                                    onClick={() => navigate('/auth/login')}
                                >
                                    Go to Login
                                </Button.Text>
                            </div>
                        </div>

                        <div css={tw`mt-6 text-center`}>
                            <button
                                type={'button'}
                                onClick={() => navigate('/auth/login')}
                                css={tw`text-xs text-neutral-300 tracking-wide no-underline uppercase font-medium hover:text-neutral-600`}
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                    <p css={tw`text-center text-neutral-300 text-xs mt-4`}>
                        &copy; {new Date().getFullYear()}&nbsp;
                        <a
                            rel={'noopener nofollow noreferrer'}
                            href={'https://m12labs.net'}
                            target={'_blank'}
                            css={tw`no-underline text-neutral-300 hover:text-green-400 duration-300`}
                        >
                            M12Labs.net
                        </a>
                        &nbsp;&middot;&nbsp;
                        <a
                            rel={'noopener nofollow noreferrer'}
                            href={'https://jexpanel.com'}
                            target={'_blank'}
                            css={tw`no-underline text-neutral-300 hover:text-green-400 duration-300`}
                        >
                            Jexpanel.com
                        </a>
                    </p>
                </div>
            </div>
        </Container>
    );
}

export default DiscordLinkChoiceContainer;
