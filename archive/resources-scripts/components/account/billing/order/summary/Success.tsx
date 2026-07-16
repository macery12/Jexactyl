import { useStoreState } from '@/state/hooks';
import PageContentBlock from '@/elements/PageContentBlock';
import SuccessSvg from '@/assets/images/themed/SuccessSvg';

export default () => {
    const { colors } = useStoreState(s => s.theme.data!);

    return (
        <PageContentBlock>
            <div className={'flex justify-center'}>
                <div
                    className={'relative w-full rounded-lg p-12 text-center shadow-lg sm:w-3/4 md:w-1/2 md:p-20'}
                    style={{ backgroundColor: colors.secondary }}
                >
                    <SuccessSvg color={colors.primary} />
                    <h2 className={'mt-10 text-4xl font-bold text-white'}>Order Processed</h2>
                    <p className={'mt-2 text-sm text-neutral-400'}>
                        Thank you for your payment - your server has now been created. Navigate to the
                        &apos;Dashboard&apos; tab at the top-left of your screen to view your new server.
                    </p>
                </div>
            </div>
        </PageContentBlock>
    );
};
