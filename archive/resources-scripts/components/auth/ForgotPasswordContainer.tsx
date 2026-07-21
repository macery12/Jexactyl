import { useStoreState } from 'easy-peasy';
import type { FormikHelpers } from 'formik';
import { Formik } from 'formik';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import tw from 'twin.macro';
import { object, string } from 'yup';
import {
    getPasswordResetMethod,
    requestPasswordReset,
    requestPasswordResetEmail,
} from '@/api/routes/auth/password-reset';
import { httpErrorToHuman } from '@/api/http';
import LoginFormContainer from '@/components/auth/LoginFormContainer';
import Turnstile from '@/components/elements/Turnstile';
import { Button } from '@/elements/button';
import Field from '@/elements/Field';
import useFlash from '@/plugins/useFlash';

interface Values {
    email: string;
    code: string;
    password: string;
    password_confirm: string;
}

function ForgotPasswordContainer() {
    const token = useRef('');
    const [captchaToken, setCaptchaToken] = useState('');
    const [resetMethod, setResetMethod] = useState<'email' | 'recovery_code'>('email');

    const { clearFlashes, addFlash } = useFlash();
    const { enabled: captchaEnabled, siteKey } = useStoreState(state => state.settings.data!.captcha);

    useEffect(() => {
        clearFlashes();
        getPasswordResetMethod()
            .then(method => setResetMethod(method))
            .catch(error => {
                console.error(error);
                setResetMethod('email');
            });
    }, []);

    const handleSubmission = (
        { email, code, password, password_confirm }: Values,
        { setSubmitting, resetForm }: FormikHelpers<Values>,
    ) => {
        clearFlashes();

        const request =
            resetMethod === 'email'
                ? requestPasswordResetEmail(email, token.current)
                : requestPasswordReset(email, code, password, password_confirm, token.current);

        request
            .then(response => {
                resetForm();
                addFlash({ type: 'success', title: 'Success', message: response });
            })
            .catch(error => {
                console.error(error);
                addFlash({ type: 'error', title: 'Error', message: httpErrorToHuman(error) });
            })
            .then(() => {
                token.current = '';
                setCaptchaToken('');
                setSubmitting(false);
            });
    };

    return (
        <Formik
            onSubmit={handleSubmission}
            initialValues={{ email: '', code: '', password: '', password_confirm: '' }}
            validationSchema={object().shape({
                email: string()
                    .email('A valid email address must be provided to continue.')
                    .required('A valid email address must be provided to continue.'),
                code:
                    resetMethod === 'recovery_code'
                        ? string().required('You must enter your account recovery code to continue.')
                        : string(),
                password: resetMethod === 'recovery_code' ? string().min(8).required() : string(),
                password_confirm: resetMethod === 'recovery_code' ? string().min(8).required() : string(),
            })}
        >
            {({ isSubmitting }) => (
                <LoginFormContainer title={'Reset your Password'} css={tw`w-full flex`}>
                    <Field
                        label={'Email Address'}
                        description={'Enter your account email address that you use to access the Panel.'}
                        name={'email'}
                        type={'email'}
                    />
                    {resetMethod === 'recovery_code' && (
                        <>
                            <div className={'mt-6'}>
                                <Field
                                    label={'Account Recovery Code'}
                                    description={
                                        "Enter the account recovery code you were given when your account was created. Don't have this code? Contact our support for assistance."
                                    }
                                    name={'code'}
                                    type={'text'}
                                />
                            </div>
                            <div className={'my-6'}>
                                <Field
                                    label={'New Password'}
                                    description={"Enter the new password you'd like to use for this user account."}
                                    name={'password'}
                                    type={'password'}
                                />
                            </div>
                            <Field
                                label={'Confirm New Password'}
                                description={'For extra security, re-enter the above password.'}
                                name={'password_confirm'}
                                type={'password'}
                            />
                        </>
                    )}
                    <div css={tw`mt-6`}>
                        <Button
                            type={'submit'}
                            className={'w-full'}
                            size={Button.Sizes.Large}
                            disabled={isSubmitting || (captchaEnabled && !captchaToken)}
                        >
                            {resetMethod === 'email' ? 'Send Reset Link' : 'Reset Password'}
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

export default ForgotPasswordContainer;
