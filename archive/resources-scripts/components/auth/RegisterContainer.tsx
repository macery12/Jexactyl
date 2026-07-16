import { useStoreState } from 'easy-peasy';
import type { FormikHelpers } from 'formik';
import { Formik } from 'formik';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import tw from 'twin.macro';
import { object, string } from 'yup';

import LoginFormContainer from '@/components/auth/LoginFormContainer';
import Turnstile from '@/components/elements/Turnstile';
import Field from '@/elements/Field';
import { Button } from '@/elements/button';
import useFlash from '@/plugins/useFlash';
import register, { checkUsernameAvailability } from '@/api/routes/auth/register';
import { useNavigate } from 'react-router-dom';
import PasswordStrengthIndicator from '@/components/auth/PasswordStrengthIndicator';
import {
    faAt,
    faIdBadge,
    faKey,
    faUnlockKeyhole,
    faCheck,
    faTimes,
    faSpinner,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

interface Values {
    username: string;
    email: string;
    password: string;
    password_confirmation: string;
}

function RegisterContainer() {
    const token = useRef('');
    const navigate = useNavigate();
    const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
    const [usernameMessage, setUsernameMessage] = useState('');
    const debounceTimer = useRef<NodeJS.Timeout | null>(null);

    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const { enabled: captchaEnabled, siteKey } = useStoreState(state => state.settings.data!.captcha);

    useEffect(() => {
        clearFlashes();
    }, []);

    const checkUsername = (username: string) => {
        if (!username || username.length < 1) {
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

    const onSubmit = (values: Values, { setSubmitting }: FormikHelpers<Values>) => {
        clearFlashes();

        register({ ...values, 'cf-turnstile-response': token.current })
            .then(response => {
                if (response.userState === 'pending') {
                    window.location.href = '/';
                    return;
                }

                if (response.complete) {
                    // @ts-expect-error this is valid
                    window.location = response.intended || '/';
                    return;
                }

                navigate('/auth/login/checkpoint', { state: { token: response.confirmationToken } });
            })
            .catch(error => {
                console.error(error);

                token.current = '';

                setSubmitting(false);
                clearAndAddHttpError({ error });
            });
    };

    return (
        <Formik
            onSubmit={onSubmit}
            initialValues={{ username: '', email: '', password: '', password_confirmation: '' }}
            validationSchema={object().shape({
                username: string().required('A username must be provided.'),
                email: string().email().required('You must provide a valid email.'),
                password: string().required('Please enter your account password.'),
                password_confirmation: string().required('Please enter the password confirmation.'),
            })}
        >
            {({ isSubmitting, setFieldValue, values }) => (
                <LoginFormContainer title={`Create an Account`}>
                    <div>
                        <Field
                            type={'text'}
                            label={'Username'}
                            icon={faIdBadge}
                            name={'username'}
                            placeholder={'user_account'}
                            disabled={isSubmitting}
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
                    <div css={tw`mt-6`}>
                        <Field
                            type={'text'}
                            label={'Email Address'}
                            icon={faAt}
                            name={'email'}
                            placeholder={'user@m12labs.net'}
                            disabled={isSubmitting}
                        />
                    </div>
                    <div css={tw`mt-6`}>
                        <Field
                            type={'password'}
                            label={'Password'}
                            icon={faKey}
                            name={'password'}
                            placeholder={'••••••••••••'}
                            disabled={isSubmitting}
                        />
                        <PasswordStrengthIndicator password={values.password} />
                    </div>
                    <div css={tw`mt-6`}>
                        <Field
                            type={'password'}
                            label={'Confirm Password'}
                            icon={faUnlockKeyhole}
                            name={'password_confirmation'}
                            placeholder={'••••••••••••'}
                            disabled={isSubmitting}
                        />
                        {values.password && values.password_confirmation && (
                            <p
                                css={[
                                    tw`text-xs mt-1`,
                                    values.password === values.password_confirmation
                                        ? tw`text-green-500`
                                        : tw`text-red-500`,
                                ]}
                            >
                                {values.password === values.password_confirmation ? (
                                    <>✓ Passwords match</>
                                ) : (
                                    <>✗ Passwords do not match</>
                                )}
                            </p>
                        )}
                    </div>
                    <div css={tw`mt-6`}>
                        <Button
                            type={'submit'}
                            loading={isSubmitting}
                            className={'w-full'}
                            size={Button.Sizes.Large}
                            disabled={isSubmitting || (captchaEnabled && !token.current)}
                        >
                            Register
                        </Button>
                    </div>
                    {captchaEnabled && siteKey && (
                        <div css={tw`mt-4 flex justify-center`}>
                            <Turnstile
                                siteKey={siteKey}
                                onVerify={response => {
                                    token.current = response;
                                }}
                                onExpire={() => {
                                    token.current = '';
                                }}
                            />
                        </div>
                    )}
                    <div css={tw`mt-6 text-center`}>
                        <Link
                            to={'/auth/login'}
                            css={tw`text-xs text-neutral-300 tracking-wide no-underline uppercase font-medium hover:text-neutral-600`}
                        >
                            Return to Login
                        </Link>
                    </div>
                </LoginFormContainer>
            )}
        </Formik>
    );
}

export default RegisterContainer;
