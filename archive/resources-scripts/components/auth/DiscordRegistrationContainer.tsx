import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Formik, FormikHelpers } from 'formik';
import { object, string, ref } from 'yup';
import tw from 'twin.macro';

import LoginFormContainer from '@/components/auth/LoginFormContainer';
import Field from '@/elements/Field';
import { Button } from '@/elements/button';
import useFlash from '@/plugins/useFlash';
import {
    getDiscordRegistrationData,
    completeDiscordRegistration,
    checkUsernameAvailability,
} from '@/api/routes/auth/discord';
import { faIdBadge, faKey, faUnlockKeyhole, faCheck, faTimes, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { faDiscord } from '@fortawesome/free-brands-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import PasswordStrengthIndicator from '@/components/auth/PasswordStrengthIndicator';

interface Values {
    username: string;
    password: string;
    confirm_password: string;
}

const passwordValidation = string();

function DiscordRegistrationContainer() {
    const navigate = useNavigate();
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const [discordData, setDiscordData] = useState<{
        discord_username: string;
        discord_email: string;
        discord_id: string;
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
    const [usernameMessage, setUsernameMessage] = useState('');
    const debounceTimer = useRef<NodeJS.Timeout | null>(null);

    const checkUsername = (username: string) => {
        if (!username) {
            setUsernameStatus('idle');
            setUsernameMessage('');
            return;
        }

        setUsernameStatus('checking');
        setUsernameMessage('Checking...');

        if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
        }

        debounceTimer.current = setTimeout(() => {
            checkUsernameAvailability(username)
                .then(response => {
                    setUsernameStatus(response.available ? 'available' : 'taken');
                    setUsernameMessage(response.message);
                })
                .catch(error => {
                    console.error(error);
                    setUsernameStatus('idle');
                    setUsernameMessage('');
                });
        }, 500);
    };

    useEffect(() => {
        clearFlashes();

        getDiscordRegistrationData()
            .then(data => {
                setDiscordData(data);
                setLoading(false);
                // Automatically check the pre-filled Discord username
                if (data.discord_username) {
                    checkUsername(data.discord_username);
                }
            })
            .catch(error => {
                console.error(error);
                clearAndAddHttpError({ error });
                // Redirect back to login if no Discord data found
                setTimeout(() => navigate('/auth/login'), 2000);
                setLoading(false);
            });
    }, []);

    const onSubmit = (values: Values, { setSubmitting }: FormikHelpers<Values>) => {
        clearFlashes();

        completeDiscordRegistration({
            username: values.username,
            password: values.password,
            confirm_password: values.confirm_password,
        })
            .then(({ userState }) => {
                if (userState === 'pending') {
                    window.location.href = '/';
                    return;
                }
                window.location.href = '/';
            })
            .catch(error => {
                console.error(error);
                setSubmitting(false);
                clearAndAddHttpError({ error });
            });
    };

    if (loading || !discordData) {
        return (
            <div className={'grid w-full 2xl:grid-cols-2'}>
                <div className={'w-full lg:mx-auto lg:w-1/2'}>
                    <h2 css={tw`text-3xl text-center text-neutral-100 font-medium py-4`}>
                        {loading ? 'Complete Your Registration' : 'Error'}
                    </h2>
                    <div css={tw`w-full bg-zinc-800/50 shadow-lg rounded-lg p-6 mx-1`}>
                        <div css={tw`text-center py-8`}>
                            {loading ? (
                                <p css={tw`text-gray-400`}>Loading Discord information...</p>
                            ) : (
                                <p css={tw`text-red-400`}>Discord registration data not found. Redirecting...</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <Formik
            onSubmit={onSubmit}
            initialValues={{
                username: discordData.discord_username || '',
                password: '',
                confirm_password: '',
            }}
            validationSchema={object().shape({
                username: string().required('A username must be provided.'),
                password: passwordValidation,
                confirm_password: string()
                    .required('Please enter the password confirmation.')
                    .oneOf([ref('password')], 'The passwords entered do not match.'),
            })}
        >
            {({ isSubmitting, setFieldValue, values }) => (
                <LoginFormContainer title={'Complete Your Discord Registration'}>
                    <div css={tw`mb-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded`}>
                        <div css={tw`flex items-center mb-2`}>
                            <FontAwesomeIcon icon={faDiscord} css={tw`text-blue-400 mr-2`} />
                            <span css={tw`text-sm font-semibold text-blue-400`}>Discord Account</span>
                        </div>
                        <p css={tw`text-xs text-gray-400`}>
                            Email: <span css={tw`text-gray-300`}>{discordData.discord_email}</span>
                        </p>
                        <p css={tw`text-xs text-gray-400`}>
                            Discord ID: <span css={tw`text-gray-300`}>{discordData.discord_id}</span>
                        </p>
                    </div>

                    <div css={tw`mt-6`}>
                        <Field
                            type={'text'}
                            label={'Username'}
                            icon={faIdBadge}
                            name={'username'}
                            placeholder={'Choose a username'}
                            disabled={isSubmitting}
                            description={'This will be your display name on the panel'}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                setFieldValue('username', e.target.value);
                                checkUsername(e.target.value);
                            }}
                        />
                        {usernameStatus !== 'idle' && (
                            <div css={tw`mt-2 flex items-center text-sm`}>
                                {usernameStatus === 'checking' && (
                                    <>
                                        <FontAwesomeIcon icon={faSpinner} spin css={tw`text-gray-400 mr-2`} />
                                        <span css={tw`text-gray-400`}>{usernameMessage}</span>
                                    </>
                                )}
                                {usernameStatus === 'available' && (
                                    <>
                                        <FontAwesomeIcon icon={faCheck} css={tw`text-green-400 mr-2`} />
                                        <span css={tw`text-green-400`}>{usernameMessage}</span>
                                    </>
                                )}
                                {usernameStatus === 'taken' && (
                                    <>
                                        <FontAwesomeIcon icon={faTimes} css={tw`text-red-400 mr-2`} />
                                        <span css={tw`text-red-400`}>{usernameMessage}</span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <div css={tw`mt-6 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded`}>
                        <p css={tw`text-xs text-yellow-400`}>
                            <strong>Note:</strong> A password is required for SFTP connections to your servers. You can
                            still log in via Discord SSO.
                        </p>
                    </div>

                    <div css={tw`mt-6`}>
                        <Field
                            type={'password'}
                            label={'Password'}
                            icon={faKey}
                            name={'password'}
                            placeholder={'••••••••••••'}
                            disabled={isSubmitting}
                            description={
                                'Must use 8+ characters with uppercase, lowercase, number, and special character, and cannot be a known compromised password.'
                            }
                        />
                        <PasswordStrengthIndicator password={values.password} />
                    </div>
                    <div css={tw`mt-6`}>
                        <Field
                            type={'password'}
                            label={'Confirm Password'}
                            icon={faUnlockKeyhole}
                            name={'confirm_password'}
                            placeholder={'••••••••••••'}
                            disabled={isSubmitting}
                        />
                    </div>

                    <div css={tw`mt-6`}>
                        <Button
                            type={'submit'}
                            loading={isSubmitting}
                            className={'w-full'}
                            size={Button.Sizes.Large}
                            disabled={isSubmitting}
                        >
                            Complete Registration
                        </Button>
                    </div>

                    <div css={tw`mt-6 text-center`}>
                        <button
                            type={'button'}
                            onClick={() => navigate('/auth/login')}
                            css={tw`text-xs text-neutral-300 tracking-wide no-underline uppercase font-medium hover:text-neutral-600`}
                        >
                            Cancel and Return to Login
                        </button>
                    </div>
                </LoginFormContainer>
            )}
        </Formik>
    );
}

export default DiscordRegistrationContainer;
