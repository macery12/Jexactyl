import { Button } from '@/elements/button';
import tw from 'twin.macro';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamationCircle, faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import { useState } from 'react';

interface AdminBypassButtonProps {
    serverUuid: string;
    bypassType: 'suspended' | 'conflict';
    serverStatus?: string | null;
    position?: 'inline' | 'absolute';
}

const AdminBypassButton = ({ serverUuid, bypassType, serverStatus, position = 'inline' }: AdminBypassButtonProps) => {
    const navigate = useNavigate();
    const [showTooltip, setShowTooltip] = useState(false);

    // Check if server is actually suspended (Wings disables access)
    const isServerSuspended = serverStatus === 'suspended';

    // For suspended bypass type, only allow bypass if server is not actually suspended
    // (i.e., blocked due to billing but not suspended by Wings)
    const isDisabled = bypassType === 'suspended' && isServerSuspended;

    const handleAdminBypass = () => {
        if (isDisabled) return;

        // Store bypass state in session storage
        sessionStorage.setItem(`admin_bypass_${bypassType}_${serverUuid}`, 'true');
        // Navigate to the server to trigger reload
        navigate(`/server/${serverUuid}`);
    };

    if (position === 'absolute') {
        // Absolute positioned version - button only in corner, tooltip on hover
        return (
            <div
                css={tw`absolute top-4 right-4 z-10`}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
            >
                <div css={tw`relative`}>
                    <Button
                        onClick={handleAdminBypass}
                        size={Button.Sizes.Large}
                        variant={Button.Variants.Secondary}
                        disabled={isDisabled}
                        css={tw`flex items-center gap-2`}
                    >
                        <FontAwesomeIcon icon={isDisabled ? faExclamationCircle : faInfoCircle} css={tw`text-sm`} />
                        Admin Bypass
                    </Button>
                    {showTooltip && (
                        <div
                            css={tw`absolute top-full right-0 mt-2 w-64 p-3 rounded-lg shadow-xl border z-20`}
                            style={{
                                backgroundColor: 'rgba(17, 24, 39, 0.95)',
                                borderColor: isDisabled ? '#7f1d1d' : '#374151',
                            }}
                        >
                            {isDisabled ? (
                                <div css={tw`flex items-start gap-2`}>
                                    <FontAwesomeIcon
                                        icon={faExclamationCircle}
                                        css={tw`text-red-400 text-sm mt-0.5 flex-shrink-0`}
                                    />
                                    <p css={tw`text-xs text-red-300`}>
                                        Server is suspended by Wings and cannot be accessed. Bypass is only available
                                        for billing-related blocks.
                                    </p>
                                </div>
                            ) : (
                                <p css={tw`text-xs text-neutral-300`}>
                                    This will bypass the {bypassType} screen without changing the server state. The
                                    server will remain in its current condition.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Inline version - keep original behavior with text below
    return (
        <div css={tw`mt-4`}>
            <Button
                onClick={handleAdminBypass}
                size={Button.Sizes.Large}
                variant={Button.Variants.Secondary}
                disabled={isDisabled}
            >
                Admin Bypass
            </Button>
            {isDisabled ? (
                <div css={tw`mt-2 flex items-start gap-2 max-w-xs`}>
                    <FontAwesomeIcon icon={faExclamationCircle} css={tw`text-red-400 text-sm mt-0.5 flex-shrink-0`} />
                    <p css={tw`text-xs text-red-300`}>
                        Server is suspended by Wings and cannot be accessed. Bypass is only available for
                        billing-related blocks.
                    </p>
                </div>
            ) : (
                <p css={tw`text-xs text-neutral-500 mt-2 max-w-xs`}>
                    This will bypass the {bypassType} screen without changing the server state.
                </p>
            )}
        </div>
    );
};

export default AdminBypassButton;
