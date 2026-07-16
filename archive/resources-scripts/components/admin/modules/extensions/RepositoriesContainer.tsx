import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/elements/button';
import Input from '@/elements/Input';
import Spinner from '@/elements/Spinner';
import useFlash from '@/plugins/useFlash';
import {
    ExtensionRepositoryData,
    createRepository,
    deleteRepository,
    getRepositories,
    updateRepository,
} from '@/api/routes/admin/extensions';

export default () => {
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();

    const [repositories, setRepositories] = useState<ExtensionRepositoryData[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [form, setForm] = useState({
        name: '',
        manifestUrl: '',
        homepageUrl: '',
        acknowledgeRisk: false,
    });

    const fetchRepositories = () => {
        setLoading(true);
        getRepositories()
            .then(data => setRepositories(data))
            .catch(error => clearAndAddHttpError({ key: 'admin:extensions', error }))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        fetchRepositories();
    }, []);

    const handleCreateRepository = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        setSubmitting(true);
        clearFlashes('admin:extensions');

        createRepository({
            name: form.name,
            manifestUrl: form.manifestUrl,
            homepageUrl: form.homepageUrl || undefined,
            acknowledgeRisk: form.acknowledgeRisk,
        })
            .then(() => {
                addFlash({
                    key: 'admin:extensions',
                    type: 'success',
                    message: 'Repository added successfully.',
                });
                setForm({
                    name: '',
                    manifestUrl: '',
                    homepageUrl: '',
                    acknowledgeRisk: false,
                });
                fetchRepositories();
            })
            .catch(error => clearAndAddHttpError({ key: 'admin:extensions', error }))
            .finally(() => setSubmitting(false));
    };

    const handleToggleRepository = (repository: ExtensionRepositoryData) => {
        clearFlashes('admin:extensions');

        updateRepository(repository.id, { enabled: !repository.enabled })
            .then(() => {
                addFlash({
                    key: 'admin:extensions',
                    type: 'success',
                    message: `${repository.name} has been ${repository.enabled ? 'disabled' : 'enabled'}.`,
                });
                fetchRepositories();
            })
            .catch(error => clearAndAddHttpError({ key: 'admin:extensions', error }));
    };

    const handleDeleteRepository = (repository: ExtensionRepositoryData) => {
        if (!window.confirm(`Delete ${repository.name}? Installed extensions are not removed automatically.`)) {
            return;
        }

        clearFlashes('admin:extensions');

        deleteRepository(repository.id)
            .then(() => {
                addFlash({
                    key: 'admin:extensions',
                    type: 'success',
                    message: `${repository.name} has been deleted.`,
                });
                fetchRepositories();
            })
            .catch(error => clearAndAddHttpError({ key: 'admin:extensions', error }));
    };

    return (
        <div className={'space-y-6'}>
            <div className={'rounded-lg border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100'}>
                Repositories can install executable PHP and frontend code into M12Labs. Checksums validate integrity
                against the selected repository manifest, but you still need to trust the repository operator.
            </div>

            <form
                className={'grid gap-4 rounded-xl border border-zinc-700 bg-zinc-900/80 p-6 lg:grid-cols-2'}
                onSubmit={handleCreateRepository}
            >
                <div className={'space-y-2'}>
                    <label className={'text-sm font-medium text-neutral-200'}>Repository name</label>
                    <Input
                        value={form.name}
                        onChange={event => setForm(current => ({ ...current, name: event.currentTarget.value }))}
                        placeholder={'Example: Community Extensions'}
                    />
                </div>
                <div className={'space-y-2'}>
                    <label className={'text-sm font-medium text-neutral-200'}>Manifest URL or local path</label>
                    <Input
                        value={form.manifestUrl}
                        onChange={event => setForm(current => ({ ...current, manifestUrl: event.currentTarget.value }))}
                        placeholder={'https://example.com/registry.json or /opt/M12Labs-Extensions/registry.json'}
                    />
                </div>
                <div className={'space-y-2 lg:col-span-2'}>
                    <label className={'text-sm font-medium text-neutral-200'}>Homepage URL</label>
                    <Input
                        value={form.homepageUrl}
                        onChange={event => setForm(current => ({ ...current, homepageUrl: event.currentTarget.value }))}
                        placeholder={'Optional support or source URL'}
                    />
                </div>
                <label
                    className={
                        'lg:col-span-2 flex items-start gap-3 rounded-lg border border-zinc-700 bg-zinc-950/60 p-4'
                    }
                >
                    <Input
                        type={'checkbox'}
                        checked={form.acknowledgeRisk}
                        onChange={event =>
                            setForm(current => ({ ...current, acknowledgeRisk: event.currentTarget.checked }))
                        }
                    />
                    <span className={'text-sm text-neutral-300'}>
                        I understand that third-party repositories can execute arbitrary code inside M12Labs, and that
                        checksums only prove the download matches that repository manifest.
                    </span>
                </label>
                <div className={'lg:col-span-2 flex justify-end'}>
                    <Button type={'submit'} loading={submitting} disabled={submitting}>
                        Add repository
                    </Button>
                </div>
            </form>

            {loading ? (
                <div className={'flex items-center justify-center py-16'}>
                    <Spinner size={'large'} />
                </div>
            ) : (
                <div className={'space-y-4'}>
                    {repositories.map(repository => (
                        <div key={repository.id} className={'rounded-xl border border-zinc-700 bg-zinc-900/80 p-5'}>
                            <div className={'flex flex-col gap-4 lg:flex-row lg:items-start'}>
                                <div className={'flex-1'}>
                                    <div className={'flex flex-wrap items-center gap-2'}>
                                        <h3 className={'text-lg font-semibold text-white'}>{repository.name}</h3>
                                        <span
                                            className={
                                                repository.official
                                                    ? 'rounded-full bg-sky-500/15 px-3 py-1 text-xs font-medium text-sky-200'
                                                    : 'rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-neutral-300'
                                            }
                                        >
                                            {repository.official ? 'Official' : 'Custom'}
                                        </span>
                                        <span
                                            className={
                                                repository.enabled
                                                    ? 'rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-200'
                                                    : 'rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-neutral-400'
                                            }
                                        >
                                            {repository.enabled ? 'Enabled' : 'Disabled'}
                                        </span>
                                        {repository.status === 'error' && (
                                            <span
                                                className={
                                                    'rounded-full bg-red-500/15 px-3 py-1 text-xs font-medium text-red-200'
                                                }
                                            >
                                                Error
                                            </span>
                                        )}
                                    </div>
                                    <p className={'mt-2 break-all text-sm text-neutral-400'}>
                                        {repository.manifestUrl}
                                    </p>
                                    {repository.homepageUrl && (
                                        <a
                                            href={repository.homepageUrl}
                                            target={'_blank'}
                                            rel={'noopener noreferrer'}
                                            className={'mt-2 inline-block text-sm text-sky-300 hover:text-sky-200'}
                                        >
                                            {repository.homepageUrl}
                                        </a>
                                    )}
                                    <p className={'mt-3 text-xs text-neutral-500'}>{repository.securityWarning}</p>
                                    {repository.status === 'error' && repository.error && (
                                        <p className={'mt-3 text-sm text-red-300'}>{repository.error}</p>
                                    )}
                                    {repository.status === 'ok' && (
                                        <p className={'mt-3 text-sm text-neutral-400'}>
                                            {repository.packagesCount} package
                                            {repository.packagesCount === 1 ? '' : 's'} available.
                                        </p>
                                    )}
                                </div>
                                <div className={'flex flex-wrap gap-2'}>
                                    <Button.Text onClick={() => handleToggleRepository(repository)}>
                                        {repository.enabled ? 'Disable' : 'Enable'}
                                    </Button.Text>
                                    {!repository.official && (
                                        <Button.Danger onClick={() => handleDeleteRepository(repository)}>
                                            Delete
                                        </Button.Danger>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
