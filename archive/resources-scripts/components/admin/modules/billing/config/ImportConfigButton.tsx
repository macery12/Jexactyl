import React, { useState } from 'react';
import { Button } from '@/elements/button';
import { faUpload } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Dialog } from '@/elements/dialog';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import useFlash from '@/plugins/useFlash';
import Switch from '@/elements/Switch';
import { Alert } from '@/elements/alert';
import {
    BillingImportConflictResponse,
    BillingImportResolution,
    importBillingConfiguration,
} from '@/api/routes/admin/billing/config';
import ImportConflictDialog from './ImportConflictDialog';

export default () => {
    const [open, setOpen] = useState<boolean>(false);
    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const [override, setOverride] = useState<boolean>(false);
    const [ignoreDuplicates, setIgnoreDuplicates] = useState<boolean>(true);
    const [uploadedJson, setUploadedJson] = useState<object | null>(null);
    const [conflictPayload, setConflictPayload] = useState<BillingImportConflictResponse | null>(null);
    const [conflictOpen, setConflictOpen] = useState<boolean>(false);

    const { clearAndAddHttpError, clearFlashes, addFlash } = useFlash();

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files ? event.target.files[0] : null;
        if (selectedFile) {
            setFile(selectedFile);
        }
    };

    const handleUploadClick = () => {
        if (!file) {
            addFlash({ key: 'billing:config', type: 'warning', message: 'No JSON file was selected for upload.' });
            return;
        }

        clearFlashes();
        setLoading(true);

        const reader = new FileReader();

        reader.onload = async e => {
            try {
                const jsonData = JSON.parse(e.target?.result as string);
                setUploadedJson(jsonData);

                await importBillingConfiguration(jsonData, override, ignoreDuplicates)
                    .then(() => {
                        setLoading(false);
                        setOpen(false);
                        setConflictOpen(false);
                        setConflictPayload(null);
                        addFlash({ key: 'billing:config', type: 'success', message: 'Import completed successfully' });
                    })
                    .catch(error => {
                        const conflictResponse =
                            error?.response?.status === 409
                                ? (error.response.data as BillingImportConflictResponse)
                                : null;

                        if (conflictResponse?.object === 'billing_import_conflict') {
                            setLoading(false);
                            setOpen(false);
                            setConflictPayload(conflictResponse);
                            setConflictOpen(true);
                            return;
                        }

                        setLoading(false);
                        setOpen(false);
                        clearAndAddHttpError({ key: 'billing:config', error });
                    });
            } catch (error) {
                setLoading(false);
                setOpen(false);
                clearAndAddHttpError({ key: 'billing:config', error });
            }
        };

        reader.readAsText(file);
    };

    const handleResolutionSubmit = async (resolution: BillingImportResolution) => {
        if (!uploadedJson) {
            addFlash({
                key: 'billing:config',
                type: 'error',
                message: 'Original import data was not found. Please upload the JSON file again.',
            });
            setConflictOpen(false);
            return;
        }

        setLoading(true);
        clearFlashes();

        await importBillingConfiguration(uploadedJson, override, ignoreDuplicates, resolution)
            .then(() => {
                setLoading(false);
                setConflictOpen(false);
                setConflictPayload(null);
                addFlash({ key: 'billing:config', type: 'success', message: 'Import completed successfully' });
            })
            .catch(error => {
                const conflictResponse =
                    error?.response?.status === 409 ? (error.response.data as BillingImportConflictResponse) : null;

                if (conflictResponse?.object === 'billing_import_conflict') {
                    setLoading(false);
                    setConflictPayload(conflictResponse);
                    setConflictOpen(true);
                    return;
                }

                setLoading(false);
                setConflictOpen(false);
                clearAndAddHttpError({ key: 'billing:config', error });
            });
    };

    return (
        <>
            <Dialog.Confirm
                onConfirmed={handleUploadClick}
                confirm={'Import Configuration'}
                open={open}
                onClose={() => setOpen(false)}
                title={'Choose JSON to import'}
            >
                <SpinnerOverlay visible={loading} />
                {override && (
                    <Alert type={'warning'}>
                        It is strongly recommended to export your current configuration before overriding it, as it
                        cannot be recovered.
                    </Alert>
                )}
                <input type="file" accept=".json" onChange={handleFileChange} className={'mt-4'} />
                <div className="mt-4 rounded border border-neutral-900 bg-neutral-800 p-4 shadow-inner">
                    <Switch
                        onChange={() => setOverride(!override)}
                        name={'override'}
                        label={'Delete existing categories and products?'}
                        description={'This will completely erase your existing products for sale.'}
                    />
                </div>
                {!override && (
                    <div className="mt-4 rounded border border-neutral-900 bg-neutral-800 p-4 shadow-inner">
                        <Switch
                            onChange={() => setIgnoreDuplicates(!ignoreDuplicates)}
                            name={'ignoreDuplicates'}
                            defaultChecked={ignoreDuplicates}
                            label={'Ignore duplicate values?'}
                            description={
                                'Setting this to true will mean that products/categories with identical names will be ignored.'
                            }
                        />
                    </div>
                )}
            </Dialog.Confirm>
            <Button onClick={() => setOpen(true)} className={'ml-2'}>
                <FontAwesomeIcon icon={faUpload} className={'mr-1'} /> Import
            </Button>
            <ImportConflictDialog
                open={conflictOpen}
                loading={loading}
                payload={conflictPayload}
                onClose={() => setConflictOpen(false)}
                onSubmit={handleResolutionSubmit}
            />
        </>
    );
};
