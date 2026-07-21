import { Dispatch, SetStateAction, useState } from 'react';
import useFlash from '@/plugins/useFlash';
import AdminBox from '@/elements/AdminBox';
import Spinner from '@/elements/Spinner';
import updateColors from '@/api/routes/admin/theme/updateColors';
import { CheckCircleIcon } from '@heroicons/react/outline';
import { useStoreActions, useStoreState } from '@/state/hooks';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { faPaintbrush } from '@fortawesome/free-solid-svg-icons';

interface Props {
    setReload: Dispatch<SetStateAction<boolean>>;
}

interface ColorRowProps {
    label: string;
    description: string;
    colorKey: string;
    value: string;
    onChange: (key: string, value: string) => void;
}

const ColorRow = ({ label, description, colorKey, value, onChange }: ColorRowProps) => (
    <div>
        <p className={'mb-2 text-sm font-medium text-neutral-200'}>{label}</p>
        <label htmlFor={colorKey} className={'flex cursor-pointer items-center gap-3'}>
            {/* Swatch — shows the real color; click opens native picker */}
            <div className={'relative h-10 w-16 flex-shrink-0 overflow-hidden rounded border border-neutral-600'}>
                <div className={'absolute inset-0'} style={{ backgroundColor: value }} />
                <input
                    id={colorKey}
                    type={'color'}
                    value={value}
                    onChange={e => onChange(colorKey, e.target.value)}
                    className={'absolute inset-0 h-full w-full cursor-pointer opacity-0'}
                />
            </div>
            {/* Hex label */}
            <span className={'font-mono text-sm text-neutral-300'}>{value}</span>
        </label>
        <p className={'mt-1 text-xs text-gray-400'}>{description}</p>
    </div>
);

export default ({ setReload }: Props) => {
    const [loading, setLoading] = useState<boolean>(false);
    const [success, setSuccess] = useState<boolean>(false);
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const colors = useStoreState(state => state.theme.data!.colors);
    const setTheme = useStoreActions(actions => actions.theme.setTheme);

    const update = async (key: string, value: string) => {
        clearFlashes();
        setReload(true);
        setLoading(true);
        setSuccess(false);

        setTheme({
            colors: {
                primary: key === 'primary' ? value : colors.primary,
                secondary: key === 'secondary' ? value : colors.secondary,

                background: key === 'background' ? value : colors.background,
                headers: key === 'headers' ? value : colors.headers,
                sidebar: key === 'sidebar' ? value : colors.sidebar,
            },
        });

        updateColors(key, value)
            .then(() => {
                setReload(false);
                setSuccess(true);
                setLoading(false);

                setTimeout(() => setSuccess(false), 2000);
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'auth:modules:discord', error });

                setLoading(false);
            });
    };

    return (
        <AdminBox title={'Color Selection'} icon={faPaintbrush}>
            <FlashMessageRender byKey={'theme:colors'} className={'my-2'} />
            {loading && <Spinner className={'absolute top-0 right-0 m-3.5'} size={'small'} />}
            {success && <CheckCircleIcon className={'absolute top-0 right-0 m-3.5 h-5 w-5 text-green-500'} />}

            <div className={'flex flex-col gap-6'}>
                <ColorRow
                    label={'Primary Content (Accent Color)'}
                    description={'Used for buttons, links and accent elements throughout the panel.'}
                    colorKey={'primary'}
                    value={colors.primary}
                    onChange={update}
                />
                <ColorRow
                    label={'Secondary Content (Components)'}
                    description={'Used for boxes, tables and other secondary components. Should be a dark, muted tone.'}
                    colorKey={'secondary'}
                    value={colors.secondary}
                    onChange={update}
                />
                <div className={'h-0.5 rounded-full border-b border-dashed border-gray-500'} />
                <ColorRow
                    label={'Background Color'}
                    description={'The main background color of the application.'}
                    colorKey={'background'}
                    value={colors.background}
                    onChange={update}
                />
                <ColorRow
                    label={'Component Headers'}
                    description={'Headers of forms, boxes and tables. Usually slightly darker than Secondary.'}
                    colorKey={'headers'}
                    value={colors.headers}
                    onChange={update}
                />
                <ColorRow
                    label={'Sidebar & Navigation'}
                    description={'The color of the sidebar on the left-hand side of your screen.'}
                    colorKey={'sidebar'}
                    value={colors.sidebar}
                    onChange={update}
                />
            </div>
        </AdminBox>
    );
};
