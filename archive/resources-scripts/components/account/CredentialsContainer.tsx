import { useState, useEffect } from 'react';
import ContentBox from '@/elements/ContentBox';
import CreateApiKeyForm from '@account/forms/CreateApiKeyForm';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faKey, faTrashAlt } from '@fortawesome/free-solid-svg-icons';
import { getApiKeys, deleteApiKey } from '@/api/routes/account/api-keys';
import { type ApiKey } from '@definitions/account';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { format } from 'date-fns';
import PageContentBlock from '@/elements/PageContentBlock';
import tw from 'twin.macro';
import GreyRowBox from '@/elements/GreyRowBox';
import { Dialog } from '@/elements/dialog';
import { useFlashKey } from '@/plugins/useFlash';
import Code from '@/elements/Code';
import ScopedAlert from '@/components/account/ScopedAlert';
import { useSSHKeys } from '@/api/routes/account/ssh-keys';
import CreateSSHKeyForm from '@account/ssh/CreateSSHKeyForm';
import DeleteSSHKeyButton from '@account/ssh/DeleteSSHKeyButton';

type CredentialType = 'api' | 'ssh';

export default () => {
    const [credentialType, setCredentialType] = useState<CredentialType>('api');
    const [deleteIdentifier, setDeleteIdentifier] = useState('');
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [loadingApi, setLoadingApi] = useState(true);
    const { clearAndAddHttpError } = useFlashKey('account');

    // SSH Keys data
    const {
        data: sshKeys,
        isValidating: isValidatingSSH,
        error: sshError,
    } = useSSHKeys({
        revalidateOnMount: true,
        revalidateOnFocus: false,
    });

    useEffect(() => {
        getApiKeys()
            .then(keys => setApiKeys(keys))
            .then(() => setLoadingApi(false))
            .catch(error => clearAndAddHttpError(error));
    }, []);

    useEffect(() => {
        clearAndAddHttpError(sshError);
    }, [sshError]);

    const doDeletion = (identifier: string) => {
        setLoadingApi(true);

        clearAndAddHttpError();
        deleteApiKey(identifier)
            .then(() => setApiKeys(s => [...(s || []).filter(key => key.identifier !== identifier)]))
            .catch(error => clearAndAddHttpError(error))
            .then(() => {
                setLoadingApi(false);
                setDeleteIdentifier('');
            });
    };

    return (
        <PageContentBlock
            title={'Credentials'}
            header
            description={'Manage your API keys and SSH keys for accessing the Panel and servers.'}
        >
            <ScopedAlert scope="account" position="top-center" />
            <FlashMessageRender byKey={'account'} />

            {/* Tab Switcher */}
            <div css={tw`flex gap-2 mb-6 mt-6`}>
                <button
                    css={[
                        tw`px-4 py-2 rounded-md font-medium transition-colors`,
                        credentialType === 'api'
                            ? tw`bg-primary-500 text-white`
                            : tw`bg-neutral-700 text-neutral-300 hover:bg-neutral-600`,
                    ]}
                    onClick={() => setCredentialType('api')}
                >
                    API Credentials
                </button>
                <button
                    css={[
                        tw`px-4 py-2 rounded-md font-medium transition-colors`,
                        credentialType === 'ssh'
                            ? tw`bg-primary-500 text-white`
                            : tw`bg-neutral-700 text-neutral-300 hover:bg-neutral-600`,
                    ]}
                    onClick={() => setCredentialType('ssh')}
                >
                    SSH Keys
                </button>
            </div>

            {/* API Credentials Content */}
            {credentialType === 'api' && (
                <div css={tw`md:flex flex-nowrap my-10`}>
                    <ContentBox title={'Create API Key'} css={tw`flex-none w-full md:w-1/2`}>
                        <CreateApiKeyForm onKeyCreated={key => setApiKeys(s => [...s!, key])} />
                    </ContentBox>
                    <ContentBox title={'API Keys'} css={tw`flex-1 overflow-hidden mt-8 md:mt-0 md:ml-8`}>
                        <SpinnerOverlay visible={loadingApi} />
                        <Dialog.Confirm
                            title={'Delete API Key'}
                            confirm={'Delete Key'}
                            open={!!deleteIdentifier}
                            onClose={() => setDeleteIdentifier('')}
                            onConfirmed={() => doDeletion(deleteIdentifier)}
                        >
                            All requests using the <Code>{deleteIdentifier}</Code> key will be invalidated.
                        </Dialog.Confirm>
                        {apiKeys.length === 0 ? (
                            <p css={tw`text-center text-sm`}>
                                {loadingApi ? 'Loading...' : 'No API keys exist for this account.'}
                            </p>
                        ) : (
                            apiKeys.map((key, index) => (
                                <GreyRowBox
                                    key={key.identifier}
                                    css={[tw`bg-neutral-600 flex items-center`, index > 0 && tw`mt-2`]}
                                >
                                    <FontAwesomeIcon icon={faKey} css={tw`text-neutral-300`} />
                                    <div css={tw`ml-4 flex-1 overflow-hidden`}>
                                        <p css={tw`text-sm break-words`}>{key.description}</p>
                                        <p css={tw`text-2xs text-neutral-300 uppercase`}>
                                            Last used:&nbsp;
                                            {key.lastUsedAt ? format(key.lastUsedAt, 'MMM do, yyyy HH:mm') : 'Never'}
                                        </p>
                                    </div>
                                    <p css={tw`text-sm ml-4 hidden md:block`}>
                                        <code css={tw`font-mono py-1 px-2 bg-neutral-900 rounded`}>
                                            {key.identifier}
                                        </code>
                                    </p>
                                    <button
                                        css={tw`ml-4 p-2 text-sm`}
                                        onClick={() => setDeleteIdentifier(key.identifier)}
                                    >
                                        <FontAwesomeIcon
                                            icon={faTrashAlt}
                                            css={tw`text-neutral-400 hover:text-red-400 transition-colors duration-150`}
                                        />
                                    </button>
                                </GreyRowBox>
                            ))
                        )}
                    </ContentBox>
                </div>
            )}

            {/* SSH Keys Content */}
            {credentialType === 'ssh' && (
                <div css={tw`md:flex flex-nowrap my-10`}>
                    <ContentBox title={'Add SSH Key'} css={tw`flex-none w-full md:w-1/2`}>
                        <CreateSSHKeyForm />
                    </ContentBox>
                    <ContentBox title={'SSH Keys'} css={tw`flex-1 overflow-hidden mt-8 md:mt-0 md:ml-8`}>
                        <SpinnerOverlay visible={!sshKeys && isValidatingSSH} />
                        {!sshKeys || !sshKeys.length ? (
                            <p css={tw`text-center text-sm`}>
                                {!sshKeys ? 'Loading...' : 'No SSH Keys exist for this account.'}
                            </p>
                        ) : (
                            sshKeys.map((key, index) => (
                                <GreyRowBox
                                    key={key.fingerprint}
                                    css={[tw`bg-black/50 flex space-x-4 items-center`, index > 0 && tw`mt-2`]}
                                >
                                    <FontAwesomeIcon icon={faKey} css={tw`text-neutral-300`} />
                                    <div css={tw`flex-1`}>
                                        <p css={tw`text-lg font-bold break-words`}>{key.name}</p>
                                        <p css={tw`text-xs mt-1 font-mono truncate text-gray-300`}>
                                            SHA256:{key.fingerprint}
                                        </p>
                                        <p css={tw`text-xs mt-1 text-gray-400 uppercase`}>
                                            Added on:&nbsp;
                                            {key.created_at.toLocaleString()}
                                        </p>
                                    </div>
                                    <DeleteSSHKeyButton name={key.name} fingerprint={key.fingerprint} />
                                </GreyRowBox>
                            ))
                        )}
                    </ContentBox>
                </div>
            )}
        </PageContentBlock>
    );
};
