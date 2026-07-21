import { TrashIcon } from '@heroicons/react/outline';
import { useFormikContext } from 'formik';
import { useEffect, useMemo, useState } from 'react';
import tw from 'twin.macro';

import Label from '@/elements/Label';
import Input from '@/elements/Input';
import { Button } from '@/elements/button';
import { useStoreState } from '@/state/hooks';

interface DockerRow {
    image: string;
    alias: string;
}

interface Props {
    name: string;
    label?: string;
}

const parseRows = (raw: string): DockerRow[] => {
    const lines = raw
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    if (lines.length < 1) {
        return [{ image: '', alias: '' }];
    }

    return lines.map(line => {
        const [imageRaw, aliasRaw] = line.split('|');
        const image = (imageRaw || '').trim();
        const alias = (aliasRaw ?? '').trim();

        return { image, alias };
    });
};

const stringifyRows = (rows: DockerRow[]): string => {
    return rows
        .filter(row => row.image.trim().length > 0)
        .map(row => {
            const image = row.image.trim();
            const alias = row.alias.trim();

            return `${image}|${alias}`;
        })
        .join('\n');
};

export default function DockerImageManager({ name, label = 'Docker Images' }: Props) {
    const { values, setFieldValue } = useFormikContext<any>();
    const { background } = useStoreState(state => state.theme.data!.colors);
    const value = useMemo(() => String(values[name] || ''), [values, name]);
    const [rows, setRows] = useState<DockerRow[]>(() => parseRows(value));

    useEffect(() => {
        setRows(parseRows(value));
    }, [value]);

    const updateRows = (next: DockerRow[]) => {
        setRows(next);
        setFieldValue(name, stringifyRows(next));
    };

    const setRow = (index: number, patch: Partial<DockerRow>) => {
        const next = [...rows];
        const current = next[index] || { image: '', alias: '' };
        next[index] = {
            image: patch.image ?? current.image,
            alias: patch.alias ?? current.alias,
        };
        updateRows(next);
    };

    return (
        <div>
            <Label>{label}</Label>

            <div css={tw`mt-2 rounded border border-neutral-700 overflow-x-auto`}>
                <table css={tw`w-full text-sm`}>
                    <thead css={tw`border-b border-neutral-700`} style={{ backgroundColor: background }}>
                        <tr>
                            <th css={tw`text-left font-medium text-neutral-300 px-3 py-2 w-3/5`}>Image URL</th>
                            <th css={tw`text-left font-medium text-neutral-300 px-3 py-2 w-1/3`}>Label</th>
                            <th css={tw`text-center font-medium text-neutral-300 px-3 py-2 w-16`}>Delete</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, index) => (
                            <tr key={index} css={tw`border-b border-neutral-800 last:border-b-0`}>
                                <td css={tw`px-3 py-2`}>
                                    <Input
                                        type={'text'}
                                        css={tw`h-9 text-sm`}
                                        placeholder={'ghcr.io/pterodactyl/yolks:java_17'}
                                        value={row.image}
                                        onChange={e => setRow(index, { image: e.currentTarget.value })}
                                    />
                                </td>

                                <td css={tw`px-3 py-2`}>
                                    <Input
                                        type={'text'}
                                        css={tw`h-9 text-sm`}
                                        placeholder={'java_17'}
                                        value={row.alias}
                                        onChange={e => setRow(index, { alias: e.currentTarget.value })}
                                    />
                                </td>

                                <td css={tw`px-3 py-2 text-center`}>
                                    <Button.Text
                                        type={'button'}
                                        css={tw`px-2 py-2 justify-center`}
                                        disabled={rows.length < 2}
                                        onClick={() => updateRows(rows.filter((_, i) => i !== index))}
                                    >
                                        <TrashIcon className={'h-4 w-4'} />
                                    </Button.Text>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div css={tw`flex items-center mt-3 gap-3`}>
                <Button.Text
                    type={'button'}
                    onClick={() => updateRows([...rows, { image: '', alias: '' }])}
                    css={tw`px-3 py-2`}
                >
                    Add Image
                </Button.Text>
                <p css={tw`text-xs text-neutral-400`}>
                    The first valid row is treated as default when aliases are duplicated.
                </p>
            </div>
        </div>
    );
}
