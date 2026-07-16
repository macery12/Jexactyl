import FeatureContainer from '@/elements/FeatureContainer';
import { faCube } from '@fortawesome/free-solid-svg-icons';
import ToggleFeatureButton from '@admin/modules/marketplace/ToggleFeatureButton';

export default () => {
    return (
        <FeatureContainer icon={faCube} title={'Marketplace Module'}>
            Enable the Marketplace module to integrate Modrinth and Spigot with M12Labs, allowing users to search for
            and install mods and plugins directly from the panel.
            <p className={'mt-2 text-right'}>
                <ToggleFeatureButton />
            </p>
        </FeatureContainer>
    );
};
