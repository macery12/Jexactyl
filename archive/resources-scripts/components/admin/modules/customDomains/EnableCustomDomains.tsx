import FeatureContainer from '@/elements/FeatureContainer';
import { faGlobe } from '@fortawesome/free-solid-svg-icons';
import ToggleCustomDomainsButton from './ToggleCustomDomainsButton';

export default () => {
    return (
        <FeatureContainer icon={faGlobe} title={'Custom Domains'}>
            Enable custom domains to manage domain inventory and offer automatic DNS mappings for customer servers.
            <p className={'mt-2 text-right'}>
                <ToggleCustomDomainsButton />
            </p>
        </FeatureContainer>
    );
};
