import { LanguageDescription } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import tw from 'twin.macro';

import getEggs from '@/api/routes/admin/nests/getEggs';
import importEgg from '@/api/routes/admin/nests/importEgg';
import useFlash from '@/plugins/useFlash';
import { Button } from '@/elements/button';
import { Size, Variant } from '@/elements/button/types';
import { Editor } from '@/elements/editor';
import Modal from '@/elements/Modal';
import FlashMessageRender from '@/elements/FlashMessageRender';

export default ({ className }: { className?: string }) => {
    const [visible, setVisible] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [mode, setMode] = useState<'upload' | 'paste'>('upload');

    const { clearFlashes, clearAndAddHttpError } = useFlash();

    const params = useParams<'nestId'>();
    const { mutate } = getEggs(Number(params.nestId));

    let fetchFileContent: (() => Promise<string>) | null = null;

    const submit = async () => {
        clearFlashes('egg:import');

        try {
            let jsonData: any;

            if (mode === 'upload') {
                if (!file) {
                    return;
                }

                const raw = await file.text();
                jsonData = JSON.parse(raw);
            } else {
                if (!fetchFileContent) {
                    return;
                }

                const jsonContent = await fetchFileContent();
                jsonData = JSON.parse(jsonContent);
            }

            const egg = await importEgg(Number(params.nestId), jsonData);
            await mutate(data => ({ ...data!, items: [...data!.items!, egg] }));
            setVisible(false);
        } catch (error) {
            clearAndAddHttpError({ key: 'egg:import', error });
        }
    };

    return (
        <>
            <Modal visible={visible} onDismissed={() => setVisible(false)}>
                <FlashMessageRender byKey={'egg:import'} css={tw`mb-6`} />

                <h2 css={tw`mb-6 text-2xl text-neutral-100`}>Import Egg</h2>

                <div css={tw`flex gap-2 mb-4`}>
                    <Button.Text type={'button'} onClick={() => setMode('upload')}>
                        Upload File
                    </Button.Text>
                    <Button.Text type={'button'} onClick={() => setMode('paste')}>
                        Paste JSON
                    </Button.Text>
                </div>

                {mode === 'upload' ? (
                    <div
                        css={tw`border-2 border-dashed border-neutral-700 rounded p-6 text-center text-neutral-300 bg-neutral-900`}
                    >
                        <p css={tw`mb-3`}>Drop in a JSON egg file or pick one below.</p>
                        <input
                            type="file"
                            accept=".json,.yaml,.yml"
                            onChange={event => setFile(event.target.files ? event.target.files[0] : null)}
                        />
                        <p css={tw`text-xs text-neutral-500 mt-3`}>{file ? file.name : 'No file selected'}</p>
                    </div>
                ) : (
                    <Editor
                        childClassName={tw`h-64 rounded`}
                        initialContent={''}
                        fetchContent={value => {
                            fetchFileContent = value;
                        }}
                        language={LanguageDescription.of({ name: 'json', support: json() })}
                    />
                )}

                <div css={tw`flex flex-wrap justify-end mt-4 sm:mt-6`}>
                    <Button.Text
                        type="button"
                        variant={Variant.Secondary}
                        css={tw`w-full sm:w-auto sm:mr-2`}
                        onClick={() => setVisible(false)}
                    >
                        Cancel
                    </Button.Text>

                    <Button css={tw`w-full sm:w-auto mt-4 sm:mt-0`} onClick={submit}>
                        Import Egg
                    </Button>
                </div>
            </Modal>

            <Button
                type="button"
                size={Size.Large}
                variant={Variant.Secondary}
                css={tw`h-10 px-4 py-0 whitespace-nowrap`}
                className={className}
                onClick={() => setVisible(true)}
            >
                Import
            </Button>
        </>
    );
};
