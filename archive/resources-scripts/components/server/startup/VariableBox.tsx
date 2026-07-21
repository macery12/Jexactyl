import { memo, useEffect, useMemo, useState } from 'react';
import { EggVariable } from '@definitions/server';
import TitledGreyBox from '@/elements/TitledGreyBox';
import { usePermissions } from '@/plugins/usePermissions';
import InputSpinner from '@/elements/InputSpinner';
import Input from '@/elements/Input';
import Switch from '@/elements/Switch';
import { debounce } from 'debounce';
import { updateStartupVariable, getServerStartup, getStartupVariableVersionOptions } from '@/api/routes/server/startup';
import type { StartupVariableVersionOption } from '@/api/routes/server/startup';
import useFlash from '@/plugins/useFlash';
import FlashMessageRender from '@/elements/FlashMessageRender';
import Select from '@/elements/Select';
import isEqual from 'react-fast-compare';
import { ServerContext } from '@/state/server';
import { reinstallServer } from '@/api/routes/server';
import { deleteFiles } from '@/api/routes/server/files';
import { Dialog } from '@/elements/dialog';
import { Button } from '@/elements/button';

interface Props {
    variable: EggVariable;
}

const SUPPORTED_VERSION_HELPER_VARIABLES = new Set([
    'VANILLA_VERSION',
    'MINECRAFT_VERSION',
    'MC_VERSION',
    'BUNGEE_VERSION',
    'BUILD_NUMBER',
    'FORGE_VERSION',
    'SPONGE_VERSION',
]);

const VariableBox = ({ variable }: Props) => {
    const FLASH_KEY = `server:startup:${variable.envVariable}`;

    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const serverVariables = ServerContext.useStoreState(state => state.server.data!.variables);
    const [loading, setLoading] = useState(false);
    const [versionModalOpen, setVersionModalOpen] = useState(false);
    const [loadingVersions, setLoadingVersions] = useState(false);
    const [savingVersion, setSavingVersion] = useState(false);
    const [selectedVersion, setSelectedVersion] = useState('');
    const [deleteJarOnSave, setDeleteJarOnSave] = useState(true);
    const [versionOptions, setVersionOptions] = useState<StartupVariableVersionOption[]>([]);
    const [versionError, setVersionError] = useState<string | null>(null);
    const [supportsSnapshots, setSupportsSnapshots] = useState(false);
    const [includeSnapshots, setIncludeSnapshots] = useState(false);
    const [reloadNonce, setReloadNonce] = useState(0);

    const [canEdit] = usePermissions(['startup.update']);
    const [canReinstall] = usePermissions(['settings.reinstall']);
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();
    const { mutate } = getServerStartup(uuid);
    const setServerFromState = ServerContext.useStoreActions(actions => actions.server.setServerFromState);

    useEffect(() => {
        setSelectedVersion(variable.serverValue ?? variable.defaultValue ?? '');
    }, [variable.serverValue, variable.defaultValue, variable.envVariable]);

    const variableContext = useMemo(() => {
        return serverVariables.reduce<Record<string, string>>((accumulator, currentVariable) => {
            if (currentVariable.envVariable === 'MINECRAFT_VERSION' || currentVariable.envVariable === 'MC_VERSION') {
                accumulator[currentVariable.envVariable] =
                    currentVariable.serverValue ?? currentVariable.defaultValue ?? '';
            }

            return accumulator;
        }, {});
    }, [serverVariables]);

    const currentServerJar = useMemo(() => {
        const jarVariable = serverVariables.find(currentVariable => currentVariable.envVariable === 'SERVER_JARFILE');

        return jarVariable?.serverValue ?? jarVariable?.defaultValue ?? 'server.jar';
    }, [serverVariables]);

    const setVariableValue = debounce((value: string) => {
        setLoading(true);
        clearFlashes(FLASH_KEY);

        updateStartupVariable(uuid, variable.envVariable, value)
            .then(([response, invocation]) => {
                mutate(
                    data => ({
                        ...data!,
                        invocation,
                        variables: (data!.variables || []).map(v =>
                            v.envVariable === response.envVariable ? response : v,
                        ),
                    }),
                    false,
                );
                setServerFromState(s => ({
                    ...s,
                    invocation,
                    variables: (s.variables || []).map(v => (v.envVariable === response.envVariable ? response : v)),
                }));
            })
            .catch(error => {
                console.error(error);
                clearAndAddHttpError({ key: FLASH_KEY, error });
            })
            .then(() => setLoading(false));
    }, 500);

    const useSwitch = variable.rules.some(
        v => v === 'boolean' || v === 'in:0,1' || v === 'in:1,0' || v === 'in:true,false' || v === 'in:false,true',
    );
    const isStringSwitch = variable.rules.some(v => v === 'string');
    const selectValues = variable.rules.find(v => v.startsWith('in:'))?.split(',') || [];
    const supportsVersionHelper =
        SUPPORTED_VERSION_HELPER_VARIABLES.has(variable.envVariable) && !useSwitch && selectValues.length === 0;

    useEffect(() => {
        if (!supportsVersionHelper || !versionModalOpen) {
            setVersionOptions([]);
            setVersionError(null);
            setSupportsSnapshots(false);

            return;
        }

        let mounted = true;
        setLoadingVersions(true);
        setVersionError(null);

        getStartupVariableVersionOptions(uuid, variable.envVariable, includeSnapshots, variableContext)
            .then(response => {
                if (!mounted) {
                    return;
                }

                setVersionOptions(response.options || []);
                setVersionError(response.error);
                setSupportsSnapshots(response.supportsSnapshots);
            })
            .catch(error => {
                if (!mounted) {
                    return;
                }

                console.error(error);
                setVersionOptions([]);
                setVersionError('Unable to load available versions right now.');
            })
            .finally(() => {
                if (mounted) {
                    setLoadingVersions(false);
                }
            });

        return () => {
            mounted = false;
        };
    }, [
        uuid,
        variable.envVariable,
        includeSnapshots,
        reloadNonce,
        supportsVersionHelper,
        versionModalOpen,
        variableContext,
    ]);

    const saveVersionAndReinstall = async () => {
        if (!selectedVersion) {
            addFlash({
                key: FLASH_KEY,
                type: 'error',
                message: 'Select a version first.',
            });

            return;
        }

        setSavingVersion(true);
        clearFlashes(FLASH_KEY);

        try {
            const [response, invocation] = await updateStartupVariable(uuid, variable.envVariable, selectedVersion);
            mutate(
                data => ({
                    ...data!,
                    invocation,
                    variables: (data!.variables || []).map(v =>
                        v.envVariable === response.envVariable ? response : v,
                    ),
                }),
                false,
            );
            setServerFromState(s => ({
                ...s,
                invocation,
                variables: (s.variables || []).map(v => (v.envVariable === response.envVariable ? response : v)),
            }));

            if (deleteJarOnSave && currentServerJar) {
                try {
                    await deleteFiles(uuid, '/', [currentServerJar]);
                } catch (error) {
                    console.error(error);
                    addFlash({
                        key: FLASH_KEY,
                        type: 'warning',
                        message: `Version was updated, but failed to delete ${currentServerJar}. Reinstall still attempted.`,
                    });
                }
            }

            await reinstallServer(uuid);

            addFlash({
                key: FLASH_KEY,
                type: 'success',
                message: deleteJarOnSave
                    ? `Reinstall started and ${currentServerJar} was queued for deletion.`
                    : 'Reinstall started. New version will be applied by the install script.',
            });
            setVersionModalOpen(false);
        } catch (error) {
            clearAndAddHttpError({ key: FLASH_KEY, error });
        } finally {
            setSavingVersion(false);
        }
    };

    return (
        <>
            <TitledGreyBox
                title={
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">
                            {!variable.isEditable && (
                                <span className="mr-2 mb-1 rounded-full bg-neutral-700 py-1 px-2 text-xs">
                                    Read Only
                                </span>
                            )}
                            {variable.name}
                        </p>
                        {supportsVersionHelper && (
                            <Button.Text
                                type={'button'}
                                onClick={() => setVersionModalOpen(true)}
                                disabled={!canEdit || !variable.isEditable}
                                size={Button.Sizes.Small}
                            >
                                Versions
                            </Button.Text>
                        )}
                    </div>
                }
            >
                <FlashMessageRender byKey={FLASH_KEY} className="mb-2 md:mb-4" />
                <InputSpinner visible={loading}>
                    {useSwitch ? (
                        <>
                            <Switch
                                readOnly={!canEdit || !variable.isEditable}
                                name={variable.envVariable}
                                defaultChecked={
                                    isStringSwitch ? variable.serverValue === 'true' : variable.serverValue === '1'
                                }
                                onChange={() => {
                                    if (canEdit && variable.isEditable) {
                                        if (isStringSwitch) {
                                            setVariableValue(variable.serverValue === 'true' ? 'false' : 'true');
                                        } else {
                                            setVariableValue(variable.serverValue === '1' ? '0' : '1');
                                        }
                                    }
                                }}
                            />
                        </>
                    ) : (
                        <>
                            {selectValues.length > 0 ? (
                                <>
                                    <Select
                                        onChange={e => setVariableValue(e.target.value)}
                                        name={variable.envVariable}
                                        defaultValue={variable.serverValue ?? variable.defaultValue}
                                        disabled={!canEdit || !variable.isEditable}
                                    >
                                        {selectValues.map(selectValue => (
                                            <option
                                                key={selectValue.replace('in:', '')}
                                                value={selectValue.replace('in:', '')}
                                            >
                                                {selectValue.replace('in:', '')}
                                            </option>
                                        ))}
                                    </Select>
                                </>
                            ) : (
                                <>
                                    <Input
                                        onKeyUp={e => {
                                            if (canEdit && variable.isEditable) {
                                                setVariableValue(e.currentTarget.value);
                                            }
                                        }}
                                        readOnly={!canEdit || !variable.isEditable}
                                        name={variable.envVariable}
                                        defaultValue={variable.serverValue ?? ''}
                                        placeholder={variable.defaultValue}
                                    />
                                </>
                            )}
                        </>
                    )}
                </InputSpinner>
            </TitledGreyBox>

            {supportsVersionHelper && (
                <Dialog
                    open={versionModalOpen}
                    title={`Select ${variable.name}`}
                    onClose={() => setVersionModalOpen(false)}
                    size={'md'}
                >
                    <div className={'text-slate-300'}>
                        <p className="mb-3 text-sm text-neutral-300">
                            Choose a version, then save to update this variable and run reinstall.
                        </p>

                        <Select
                            disabled={loadingVersions || !canEdit || !variable.isEditable || savingVersion}
                            value={selectedVersion}
                            onChange={e => setSelectedVersion(e.target.value)}
                        >
                            <option value={''}>Select version...</option>
                            {versionOptions.map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </Select>

                        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                            <button
                                type="button"
                                className="rounded border border-neutral-700 px-2 py-1 text-neutral-200 hover:bg-neutral-800"
                                onClick={() => setReloadNonce(value => value + 1)}
                                disabled={loadingVersions || savingVersion}
                            >
                                {loadingVersions ? 'Refreshing...' : 'Refresh list'}
                            </button>

                            {supportsSnapshots && (
                                <label className="flex cursor-pointer items-center gap-2 text-neutral-300">
                                    <input
                                        type="checkbox"
                                        checked={includeSnapshots}
                                        onChange={e => setIncludeSnapshots(e.currentTarget.checked)}
                                        disabled={savingVersion}
                                    />
                                    Include snapshots
                                </label>
                            )}
                        </div>

                        <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-neutral-300">
                            <input
                                type="checkbox"
                                checked={deleteJarOnSave}
                                onChange={e => setDeleteJarOnSave(e.currentTarget.checked)}
                                disabled={savingVersion}
                            />
                            Delete current jar before reinstall ({currentServerJar})
                        </label>

                        {versionError && <p className="mt-2 text-xs text-red-300">{versionError}</p>}

                        <div className="mt-4 rounded-lg bg-yellow-500/20 p-4 text-sm">
                            <p className="mb-2 font-bold text-yellow-300">BACKUP YOUR FILES FIRST</p>
                            <p>
                                Saving here updates the version variable and runs reinstall so the installation script
                                can download that version.
                            </p>
                        </div>

                        {!canReinstall && (
                            <p className="mt-3 text-xs text-neutral-300">
                                You do not have permission to reinstall this server. Ask an admin to apply the version
                                change.
                            </p>
                        )}
                    </div>

                    <Dialog.Footer>
                        <Button.Text onClick={() => setVersionModalOpen(false)} disabled={savingVersion}>
                            Cancel
                        </Button.Text>
                        <Button.Danger
                            onClick={saveVersionAndReinstall}
                            disabled={savingVersion || !canEdit || !variable.isEditable || !canReinstall}
                        >
                            {savingVersion ? 'Saving...' : 'Save + Reinstall'}
                        </Button.Danger>
                    </Dialog.Footer>
                </Dialog>
            )}
        </>
    );
};

export default memo(VariableBox, isEqual);
