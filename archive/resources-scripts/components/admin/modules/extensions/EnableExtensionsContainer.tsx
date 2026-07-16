import { useStoreState } from '@/state/hooks';
import { faPuzzlePiece } from '@fortawesome/free-solid-svg-icons';
import FeatureContainer from '@/elements/FeatureContainer';
import ToggleExtensionsButton from './ToggleExtensionsButton';
import ExtensionsSvg from './ExtensionsSvg';

export default () => {
    const primary = useStoreState(state => state.theme.data!.colors.primary);

    return (
        <FeatureContainer image={<ExtensionsSvg color={primary} />} icon={faPuzzlePiece} title={'M12Labs Extensions'}>
            Enable the M12Labs extension system to install panel extensions from the official repository or your own
            approved repositories. Each extension can be enabled per server type with its own settings, access rules,
            and uninstall path.
            <p className={'text-right'}>
                <ToggleExtensionsButton />
            </p>
        </FeatureContainer>
    );
};
