import { Route, Routes } from 'react-router-dom';
import AdminContentBlock from '@/elements/AdminContentBlock';
import FlashMessageRender from '@/elements/FlashMessageRender';
import ApiContainer from './ApiContainer';
import NewApiKeyContainer from './NewApiKeyContainer';
import { NotFound } from '@/elements/ScreenBlock';

export default () => (
    <AdminContentBlock title={'Application API'}>
        <div className={'mb-8 flex w-full flex-col gap-2 sm:flex-row sm:items-center'}>
            <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                <h2 className={'font-header text-2xl font-medium text-neutral-50'}>Application API</h2>
                <p
                    className={
                        'hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400 lg:block'
                    }
                >
                    Create, update and delete administrative API keys for this Panel.
                </p>
            </div>
        </div>

        <FlashMessageRender byKey={'admin:settings'} className={'mb-4'} />

        <Routes>
            <Route path={'/'} element={<ApiContainer />} />
            <Route path={'/new'} element={<NewApiKeyContainer />} />
            <Route path={'*'} element={<NotFound />} />
        </Routes>
    </AdminContentBlock>
);
