import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { resetPasswordWithToken } from '@/api/routes/auth/password-reset';
import { httpErrorToHuman } from '@/api/http';
import LoginFormContainer from '@/components/auth/LoginFormContainer';
import { Actions, useStoreActions } from 'easy-peasy';
import { ApplicationStore } from '@/state';
import { Formik, FormikHelpers } from 'formik';
import { object, ref, string } from 'yup';
import Field from '@/elements/Field';
import Input from '@/elements/Input';
import tw from 'twin.macro';
import { Button } from '@/elements/button';
import Label from '@/elements/Label';
import Turnstile from '@/components/elements/Turnstile';
import PasswordStrengthIndicator from '@/components/auth/PasswordStrengthIndicator';
import { useStoreState } from '@/state/hooks';

interface Values {
    password: string;
    passwordConfirmation: string;
}

function ResetPasswordWithTokenContainer() {
    const token = useRef('');
    const [email, setEmail] = useState('');
    const { enabled: captchaEnabled, siteKey } = useStoreState(state => state.settings.data!.captcha);

    const { clearFlashes, addFlash } = useStoreActions((actions: Actions<ApplicationStore>) => actions.flashes);

    useEffect(() => {
        const parsed = new URLSearchParams(location.search);
        setEmail(parsed.get('email') || '');
    }, []);

    const params = useParams<'token'>();

    const submit = ({ password, passwordConfirmation }: Values, { setSubmitting }: FormikHelpers<Values>) => {
        clearFlashes();
        resetPasswordWithToken(email, { token: params.token ?? '', password, passwordConfirmation }, token.current)
            .then(() => {
                window.location.href = '/auth/login';
            })
            .catch(error => {
                console.error(error);

                setSubmitting(false);
                addFlash({ type: 'error', title: 'Error', message: httpErrorToHuman(error) });
            });
    };

    return (
        <Formik
            onSubmit={submit}
            initialValues={{
                password: '',
                passwordConfirmation: '',
            }}
            validationSchema={object().shape({
                password: string()
                    .required('A new password is required.')
                    .min(8, 'Your new password should be at least 8 characters in length.')
                    .matches(/[A-Z]/, 'Password must include at least one uppercase letter.')
                    .matches(/[a-z]/, 'Password must include at least one lowercase letter.')
                    .matches(/[0-9]/, 'Password must include at least one number.')
                    .matches(
                        /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/,
                        'Password must include at least one special character.',
                    ),
                passwordConfirmation: string()
                    .required('Your new password does not match.')
                    .oneOf([ref('password')], 'Your new password does not match.'),
            })}
        >
            {({ isSubmitting, values }) => (
                <LoginFormContainer title={'Reset Password'} css={tw`w-full flex`}>
                    <div>
                        <Label>Email Address</Label>
                        <Input value={email} disabled />
                    </div>
                    <div css={tw`mt-6`}>
                        <Field
                            label={'New Password'}
                            name={'password'}
                            type={'password'}
                            description={
                                'Must use 8+ characters with uppercase, lowercase, number, and special character, and cannot be a known compromised password.'
                            }
                        />
                        <PasswordStrengthIndicator password={values.password} />
                    </div>
                    <div css={tw`mt-6`}>
                        <Field label={'Confirm New Password'} name={'passwordConfirmation'} type={'password'} />
                    </div>
                    <div css={tw`mt-6`}>
                        <Button
                            className={'w-full'}
                            size={Button.Sizes.Large}
                            type={'submit'}
                            disabled={isSubmitting || (captchaEnabled && !token.current)}
                        >
                            Reset Password
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

export default ResetPasswordWithTokenContainer;
