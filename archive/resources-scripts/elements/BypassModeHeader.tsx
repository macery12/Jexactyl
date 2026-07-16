import { Button } from '@/elements/button';
import tw from 'twin.macro';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamationTriangle, faTimes } from '@fortawesome/free-solid-svg-icons';

interface BypassModeHeaderProps {
    serverUuid: string;
    bypassType: 'suspended' | 'conflict';
}

const BypassModeHeader = ({ serverUuid, bypassType }: BypassModeHeaderProps) => {
    const navigate = useNavigate();

    const handleExitBypass = () => {
        // Remove bypass state from session storage
        sessionStorage.removeItem(`admin_bypass_${bypassType}_${serverUuid}`);
        // Navigate to trigger reload and show the blocking screen again
        navigate(`/server/${serverUuid}`);
    };

    return (
        <div css={tw`bg-yellow-900/30 border-b border-yellow-700/50 px-6 py-3 flex items-center justify-between`}>
            <div css={tw`flex items-center gap-3`}>
                <FontAwesomeIcon icon={faExclamationTriangle} css={tw`text-yellow-400 text-xl`} />
                <div>
                    <p css={tw`text-yellow-100 font-semibold text-sm`}>Admin Bypass Mode Active</p>
                    <p css={tw`text-yellow-300/80 text-xs`}>
                        You are viewing this server with admin bypass. The server state remains unchanged.
                    </p>
                </div>
            </div>
            <Button
                onClick={handleExitBypass}
                size={Button.Sizes.Small}
                variant={Button.Variants.Secondary}
                css={tw`flex items-center gap-2`}
            >
                <FontAwesomeIcon icon={faTimes} />
                Exit Bypass
            </Button>
        </div>
    );
};

export default BypassModeHeader;
