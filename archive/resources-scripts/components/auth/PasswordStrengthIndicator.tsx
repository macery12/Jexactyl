import { useEffect, useState } from 'react';
import { faCheck, faTimes, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import tw from 'twin.macro';

interface Props {
    password: string;
}

interface PasswordRequirements {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSpecialChar: boolean;
}

export default ({ password }: Props) => {
    const [requirements, setRequirements] = useState<PasswordRequirements>({
        minLength: false,
        hasUppercase: false,
        hasLowercase: false,
        hasNumber: false,
        hasSpecialChar: false,
    });
    const [isPwned, setIsPwned] = useState<boolean | null>(null);
    const [pwnedCount, setPwnedCount] = useState<number>(0);
    const [checking, setChecking] = useState(false);

    // Check password requirements
    useEffect(() => {
        setRequirements({
            minLength: password.length >= 8,
            hasUppercase: /[A-Z]/.test(password),
            hasLowercase: /[a-z]/.test(password),
            hasNumber: /[0-9]/.test(password),
            hasSpecialChar: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
        });
    }, [password]);

    // Check against Have I Been Pwned (debounced)
    useEffect(() => {
        if (password.length < 8) {
            setIsPwned(null);
            setPwnedCount(0);
            return;
        }

        setChecking(true);
        const timer = setTimeout(async () => {
            try {
                // Use k-anonymity model: only send first 5 chars of SHA-1 hash
                const encoder = new TextEncoder();
                const data = encoder.encode(password);
                const hashBuffer = await crypto.subtle.digest('SHA-1', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

                const prefix = hashHex.substring(0, 5).toUpperCase();
                const suffix = hashHex.substring(5).toUpperCase();

                const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
                const text = await response.text();

                const lines = text.split('\n');
                const found = lines.find(line => line.startsWith(suffix));

                if (found) {
                    const count = parseInt(found.split(':')[1] ?? '0', 10);
                    setIsPwned(true);
                    setPwnedCount(count);
                } else {
                    setIsPwned(false);
                    setPwnedCount(0);
                }
            } catch (error) {
                // Fail silently - don't block user if API is down
                setIsPwned(null);
                setPwnedCount(0);
            } finally {
                setChecking(false);
            }
        }, 1000); // Debounce by 1 second

        return () => clearTimeout(timer);
    }, [password]);

    if (!password) {
        return null;
    }

    return (
        <div css={tw`mt-2 text-sm`}>
            <div css={tw`mb-2 text-gray-400`}>Password requirements:</div>
            <div css={tw`space-y-1`}>
                <RequirementItem met={requirements.minLength} text="At least 8 characters" />
                <RequirementItem met={requirements.hasUppercase} text="At least one uppercase letter" />
                <RequirementItem met={requirements.hasLowercase} text="At least one lowercase letter" />
                <RequirementItem met={requirements.hasNumber} text="At least one number" />
                <RequirementItem met={requirements.hasSpecialChar} text="At least one special character" />
            </div>

            {isPwned !== null && (
                <div
                    css={tw`mt-3 p-2 rounded border`}
                    className={isPwned ? 'bg-red-900/20 border-red-700' : 'bg-green-900/20 border-green-700'}
                >
                    <div css={tw`flex items-center gap-2`}>
                        <FontAwesomeIcon
                            icon={isPwned ? faExclamationTriangle : faCheck}
                            css={isPwned ? tw`text-red-400` : tw`text-green-400`}
                        />
                        <span css={isPwned ? tw`text-red-300` : tw`text-green-300`}>
                            {isPwned
                                ? `Warning: This password has been exposed in ${pwnedCount.toLocaleString()} data breach${
                                      pwnedCount !== 1 ? 'es' : ''
                                  }. Consider using a different password.`
                                : 'This password has not been found in known data breaches.'}
                        </span>
                    </div>
                </div>
            )}

            {checking && password.length >= 8 && (
                <div css={tw`mt-2 text-xs text-gray-500`}>Checking password against breach database...</div>
            )}
        </div>
    );
};

interface RequirementItemProps {
    met: boolean;
    text: string;
}

const RequirementItem = ({ met, text }: RequirementItemProps) => (
    <div css={tw`flex items-center gap-2`}>
        <FontAwesomeIcon icon={met ? faCheck : faTimes} css={met ? tw`text-green-400` : tw`text-gray-600`} fixedWidth />
        <span css={met ? tw`text-gray-300` : tw`text-gray-500`}>{text}</span>
    </div>
);
