import { useStoreState } from 'easy-peasy';
import type { FormikHelpers } from 'formik';
import { Formik } from 'formik';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import tw from 'twin.macro';
import { object, string } from 'yup';

import { login, externalLogin } from '@/api/routes/auth/login';
import LoginFormContainer from '@/components/auth/LoginFormContainer';
import Turnstile from '@/components/elements/Turnstile';
import Field from '@/elements/Field';
import { Button } from '@/elements/button';
import useFlash from '@/plugins/useFlash';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDiscord, faGoogle } from '@fortawesome/free-brands-svg-icons';
import Label from '@/elements/Label';
import { faAt, faEnvelope, faKey } from '@fortawesome/free-solid-svg-icons';

interface Values {
    username: string;
    password: string;
}

function LoginContainer() {
    const token = useRef('');
    const [captchaToken, setCaptchaToken] = useState('');

    const appName = useStoreState(state => state.settings.data!.name);
    const modules = useStoreState(state => state.everest.data!.auth.modules);
    const registration = useStoreState(state => state.everest.data!.auth.registration.enabled);

    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const { enabled: captchaEnabled, siteKey } = useStoreState(state => state.settings.data!.captcha);

    const navigate = useNavigate();

    useEffect(() => {
        clearFlashes();
    }, []);

    const useOauth = (name: string) => {
        externalLogin(name, token.current)
            .then(url => {
                // @ts-expect-error this is fine
                window.location = url;
            })
            .catch(error => clearAndAddHttpError({ key: 'auth:register', error }));
    };

    const onSubmit = (values: Values, { setSubmitting }: FormikHelpers<Values>) => {
        clearFlashes();

        login({ ...values, 'cf-turnstile-response': token.current })
            .then(response => {
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
                setCaptchaToken('');

                setSubmitting(false);
                clearAndAddHttpError({ error });
            });
    };

    return (
        <Formik
            onSubmit={onSubmit}
            initialValues={{ username: '', password: '' }}
            validationSchema={object().shape({
                username: string().required('A username or email must be provided.'),
                password: string().required('Please enter your account password.'),
            })}
        >
            {({ isSubmitting }) => (
                <LoginFormContainer title={`Welcome to ${appName}`}>
                    <Field
                        icon={faAt}
                        type={'text'}
                        label={'Username or Email'}
                        name={'username'}
                        disabled={isSubmitting}
                        placeholder={'user@m12labs.net'}
                    />
                    <div css={tw`mt-6`}>
                        <Label>
                            Password
                            <Link
                                to={'/auth/password'}
                                tabIndex={-1}
                                className={'ml-1 text-xs text-green-400 duration-300 hover:text-green-200'}
                            >
                                Forgot Password?
                            </Link>
                        </Label>
                        <Field
                            icon={faKey}
                            type={'password'}
                            name={'password'}
                            disabled={isSubmitting}
                            placeholder={'••••••••••••'}
                        />
                    </div>
                    <div css={tw`mt-6`}>
                        <Button
                            type={'submit'}
                            loading={isSubmitting}
                            className={'w-full'}
                            size={Button.Sizes.Large}
                            disabled={isSubmitting || (captchaEnabled && !captchaToken)}
                        >
                            Login
                        </Button>
                    </div>
                    {captchaEnabled && siteKey && (
                        <div css={tw`mt-4 flex justify-center`}>
                            <Turnstile
                                siteKey={siteKey}
                                onVerify={response => {
                                    token.current = response;
                                    setCaptchaToken(response);
                                }}
                                onExpire={() => {
                                    token.current = '';
                                    setCaptchaToken('');
                                }}
                            />
                        </div>
                    )}
                    {(modules.discord.enabled || modules.google.enabled || registration) && (
                        <div className={'my-3 w-full text-center text-gray-400'}>OR</div>
                    )}
                    <div className={'mt-4 grid w-full grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-4'}>
                        {modules.discord.enabled && (
                            <Button.Info
                                type={'button'}
                                onClick={() => useOauth('discord')}
                                size={Button.Sizes.Small}
                                disabled={captchaEnabled && !captchaToken}
                            >
                                <FontAwesomeIcon icon={faDiscord} className={'my-auto mr-2'} /> Use Discord SSO
                            </Button.Info>
                        )}
                        {modules.google.enabled && (
                            <Button.Text
                                type={'button'}
                                onClick={() => useOauth('google')}
                                size={Button.Sizes.Small}
                                disabled={captchaEnabled && !captchaToken}
                            >
                                <FontAwesomeIcon icon={faGoogle} className={'my-auto mr-2'} /> Use Google SSO
                            </Button.Text>
                        )}
                        {registration && (
                            <Button.Text
                                type={'button'}
                                onClick={() => navigate('/auth/register')}
                                size={Button.Sizes.Small}
                            >
                                <FontAwesomeIcon icon={faEnvelope} className={'my-auto mr-2'} /> Register with Email
                            </Button.Text>
                        )}
                    </div>
                </LoginFormContainer>
            )}
        </Formik>
    );
}

export default LoginContainer;
