import { Form, Formik } from 'formik';
import AdminBox from '@/elements/AdminBox';
import { useStoreState, useStoreActions } from '@/state/hooks';
import { CogIcon, TrashIcon } from '@heroicons/react/outline';
import { MarketplaceSettings, updateSettings } from '@/api/routes/admin/marketplace/settings';
import { useFlashKey } from '@/plugins/useFlash';
import { Button } from '@/elements/button';
import Label from '@/elements/Label';
import Select from '@/elements/Select';
import Input from '@/elements/Input';
import ToggleSwitch from '@/elements/ToggleSwitch';
import ToggleFeatureButton from './ToggleFeatureButton';

const SettingsContainer = () => {
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlashKey('admin:marketplace');
    const mods = useStoreState(s => s.everest.data!.mods);
    const updateEverest = useStoreActions(s => s.everest.updateEverest);

    const submit = (values: MarketplaceSettings) => {
        clearFlashes();

        const payload: MarketplaceSettings = {
            enabled:                    values.enabled,
            default_source:             values.default_source,
            allow_external_downloads:   values.allow_external_downloads,
            curseforge_cdn_fallback:    values.curseforge_cdn_fallback,
            curseforge_enabled:         values.curseforge_enabled,
            download_max_concurrent:    Number(values.download_max_concurrent),
            download_max_per_minute:    Number(values.download_max_per_minute),
            download_max_queue_size:    Number(values.download_max_queue_size),
            max_mod_size:               Number(values.max_mod_size),
            max_plugin_size:            Number(values.max_plugin_size),
        };

        // Only send the API key when the admin actually entered one — leaving the
        // field blank preserves the existing (encrypted) key on the server.
        const enteredKey = (values.curseforge_api_key ?? '').trim();
        if (enteredKey !== '') {
            payload.curseforge_api_key = enteredKey;
        }

        updateSettings(payload)
            .then(() => {
                const { curseforge_api_key, ...everestSafe } = payload;
                updateEverest({
                    mods: {
                        ...mods,
                        ...everestSafe,
                        curseforge: {
                            enabled: !!values.curseforge_enabled,
                            configured: (mods.curseforge?.configured ?? false) || enteredKey !== '',
                        },
                    },
                });
                addFlash({ type: 'success', message: 'Marketplace settings saved.' });
            })
            .catch(error => clearAndAddHttpError(error));
    };

    const dl = mods.download;

    return (
        <div className={'grid gap-4 lg:grid-cols-3'}>
            <div className={'col-span-2 flex flex-col gap-4'}>
                <Formik
                    onSubmit={submit}
                    initialValues={{
                        enabled:                    mods.enabled,
                        default_source:             mods.default_source || 'modrinth',
                        allow_external_downloads:   mods.allow_external_downloads ?? false,
                        curseforge_cdn_fallback:    mods.curseforge_cdn_fallback ?? true,
                        curseforge_enabled:         mods.curseforge?.enabled ?? false,
                        curseforge_api_key:         '',
                        download_max_concurrent:    dl?.max_concurrent_per_server ?? 3,
                        download_max_per_minute:    dl?.max_per_minute_per_user ?? 10,
                        download_max_queue_size:    dl?.max_queue_size_per_server ?? 20,
                        // sizes stored as bytes in DB, shown as MB in UI
                        max_mod_size:               (dl?.max_mod_size_mb ?? 150) * 1048576,
                        max_plugin_size:            (dl?.max_plugin_size_mb ?? 100) * 1048576,
                    }}
                >
                    {({ values, setFieldValue }) => (
                        <Form className={'flex flex-col gap-4'}>
                            <AdminBox title={'Marketplace Settings'} icon={CogIcon}>
                                <div className={'flex flex-col gap-6'}>
                                    {/* Enabled toggle */}
                                    <div className={'flex items-center justify-between gap-4'}>
                                        <div>
                                            <p className={'text-sm font-medium text-neutral-200'}>
                                                Enable Marketplace Module
                                            </p>
                                            <p className={'mt-0.5 text-xs text-neutral-400'}>
                                                Allow users to search and install mods and plugins through the panel.
                                            </p>
                                        </div>
                                        <ToggleSwitch
                                            checked={values.enabled}
                                            onChange={() => setFieldValue('enabled', !values.enabled)}
                                            label={'Toggle marketplace enabled'}
                                        />
                                    </div>

                                    <div className={'border-t border-neutral-700'} />

                                    {/* Default source */}
                                    <div className={'flex flex-col gap-2'}>
                                        <Label>Default Content Source</Label>
                                        <Select
                                            value={values.default_source}
                                            onChange={e => setFieldValue('default_source', e.target.value)}
                                        >
                                            <option value="modrinth">Modrinth</option>
                                            <option value="spigot">Spigot</option>
                                        </Select>
                                        <p className={'text-xs text-neutral-400'}>
                                            The default source shown to users.
                                        </p>
                                    </div>

                                    <div className={'border-t border-neutral-700'} />

                                    {/* External Downloads */}
                                    <div className={'flex items-start justify-between gap-4'}>
                                        <div className={'flex-1'}>
                                            <p className={'text-sm font-medium text-neutral-200'}>
                                                Allow External Downloads
                                            </p>
                                            <p className={'mt-0.5 text-xs text-neutral-400'}>
                                                Allows users to download Spigot plugins hosted on external sites (e.g.
                                                GitHub, plugin author websites). These sources are not verified by
                                                SpigotMC or Modrinth.
                                            </p>
                                            <div
                                                className={
                                                    'mt-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400'
                                                }
                                            >
                                                <strong>Disclaimer:</strong> External downloads may originate from
                                                unknown sources outside of SpigotMC. While most are safe, this option
                                                is disabled by default for security. Only enable it if you trust the
                                                plugins your users install.
                                            </div>
                                        </div>
                                        <ToggleSwitch
                                            checked={values.allow_external_downloads ?? false}
                                            onChange={() =>
                                                setFieldValue(
                                                    'allow_external_downloads',
                                                    !values.allow_external_downloads
                                                )
                                            }
                                            label={'Toggle external downloads'}
                                        />
                                    </div>

                                    <div className={'border-t border-neutral-700'} />

                                    {/* CurseForge CDN Fallback */}
                                    <div className={'flex items-start justify-between gap-4'}>
                                        <div className={'flex-1'}>
                                            <p className={'text-sm font-medium text-neutral-200'}>
                                                CurseForge CDN Fallback
                                            </p>
                                            <p className={'mt-0.5 text-xs text-neutral-400'}>
                                                When enabled, mods that authors have disabled third-party downloads for
                                                will be fetched directly from the CurseForge CDN instead of being
                                                skipped. API-provided links are always preferred; the CDN is only used
                                                as a fallback. Disable to revert to showing those mods as manual-only.
                                            </p>
                                        </div>
                                        <ToggleSwitch
                                            checked={values.curseforge_cdn_fallback ?? true}
                                            onChange={() =>
                                                setFieldValue(
                                                    'curseforge_cdn_fallback',
                                                    !values.curseforge_cdn_fallback
                                                )
                                            }
                                            label={'Toggle CurseForge CDN fallback'}
                                        />
                                    </div>

                                    <div className={'border-t border-neutral-700'} />

                                    {/* CurseForge (modpacks) */}
                                    <div className={'flex flex-col gap-4'}>
                                        <div className={'flex items-start justify-between gap-4'}>
                                            <div className={'flex-1'}>
                                                <p className={'text-sm font-medium text-neutral-200'}>
                                                    CurseForge Modpacks
                                                </p>
                                                <p className={'mt-0.5 text-xs text-neutral-400'}>
                                                    Enables the Modpacks tab for mod-loader servers (Forge, NeoForge,
                                                    Fabric, Quilt). Requires a CurseForge API key.
                                                </p>
                                            </div>
                                            <ToggleSwitch
                                                checked={values.curseforge_enabled ?? false}
                                                onChange={() =>
                                                    setFieldValue('curseforge_enabled', !values.curseforge_enabled)
                                                }
                                                label={'Toggle CurseForge modpacks'}
                                            />
                                        </div>

                                        <div className={'flex flex-col gap-2'}>
                                            <Label>CurseForge API Key</Label>
                                            <Input
                                                type="password"
                                                autoComplete="off"
                                                placeholder={
                                                    mods.curseforge?.configured
                                                        ? '•••••••••• (configured — leave blank to keep)'
                                                        : 'Enter your CurseForge API key'
                                                }
                                                value={values.curseforge_api_key ?? ''}
                                                onChange={e => setFieldValue('curseforge_api_key', e.target.value)}
                                            />
                                            <p className={'text-xs text-neutral-400'}>
                                                Stored encrypted. Leave blank to keep the existing key.{' '}
                                                {mods.curseforge?.configured ? (
                                                    <span className={'text-green-400'}>A key is currently configured.</span>
                                                ) : (
                                                    <span className={'text-amber-400'}>No key configured yet.</span>
                                                )}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className={'mt-6 flex items-center justify-between border-t border-neutral-700 pt-4'}>
                                    <p className={'text-xs text-neutral-500'}>Changes apply immediately after saving.</p>
                                    <Button type="submit">Save Changes</Button>
                                </div>
                            </AdminBox>

                            {/* Download Queue Settings */}
                            <AdminBox title={'Download Queue'} icon={CogIcon}>
                                <p className={'mb-4 text-xs text-neutral-400'}>
                                    Controls how the background download queue behaves across all servers.
                                </p>
                                <div className={'grid grid-cols-1 gap-6 sm:grid-cols-2'}>
                                    <div className={'flex flex-col gap-2'}>
                                        <Label>Max Concurrent Downloads (per server)</Label>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={10}
                                            value={values.download_max_concurrent}
                                            onChange={e => setFieldValue('download_max_concurrent', e.target.value)}
                                        />
                                        <p className={'text-xs text-neutral-400'}>
                                            How many files can download simultaneously on one server. Default: 3.
                                        </p>
                                    </div>

                                    <div className={'flex flex-col gap-2'}>
                                        <Label>Max Queue Submissions (per user per minute)</Label>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={60}
                                            value={values.download_max_per_minute}
                                            onChange={e => setFieldValue('download_max_per_minute', e.target.value)}
                                        />
                                        <p className={'text-xs text-neutral-400'}>
                                            How many downloads a user can submit per minute. Default: 10.
                                        </p>
                                    </div>

                                    <div className={'flex flex-col gap-2'}>
                                        <Label>Max Queue Size (per server)</Label>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={100}
                                            value={values.download_max_queue_size}
                                            onChange={e => setFieldValue('download_max_queue_size', e.target.value)}
                                        />
                                        <p className={'text-xs text-neutral-400'}>
                                            Maximum number of pending + downloading items per server. Default: 20.
                                        </p>
                                    </div>

                                    <div className={'flex flex-col gap-2'}>
                                        <Label>Max Mod File Size (MB)</Label>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={500}
                                            value={Math.round(Number(values.max_mod_size) / 1048576)}
                                            onChange={e =>
                                                setFieldValue('max_mod_size', Number(e.target.value) * 1048576)
                                            }
                                        />
                                        <p className={'text-xs text-neutral-400'}>
                                            Maximum file size for mod downloads in MB. Default: 150.
                                        </p>
                                    </div>

                                    <div className={'flex flex-col gap-2'}>
                                        <Label>Max Plugin File Size (MB)</Label>
                                        <Input
                                            type="number"
                                            min={1}
                                            max={500}
                                            value={Math.round(Number(values.max_plugin_size) / 1048576)}
                                            onChange={e =>
                                                setFieldValue('max_plugin_size', Number(e.target.value) * 1048576)
                                            }
                                        />
                                        <p className={'text-xs text-neutral-400'}>
                                            Maximum file size for plugin downloads in MB. Default: 100.
                                        </p>
                                    </div>
                                </div>

                                <div className={'mt-6 flex items-center justify-between border-t border-neutral-700 pt-4'}>
                                    <p className={'text-xs text-neutral-500'}>Changes apply immediately after saving.</p>
                                    <Button type="submit">Save Changes</Button>
                                </div>
                            </AdminBox>
                        </Form>
                    )}
                </Formik>
            </div>

            {/* Danger zone */}
            <div>
                <AdminBox title={'Danger Zone'} icon={TrashIcon}>
                    <p className={'text-sm text-neutral-400'}>
                        Disabling the Marketplace module removes access for all users.
                    </p>
                    <div className={'mt-4'}>
                        <ToggleFeatureButton />
                    </div>
                </AdminBox>
            </div>
        </div>
    );
};

export default SettingsContainer;
