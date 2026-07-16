import { useContext, useEffect } from 'react';
import { getRoles, Context as RolesContext, Filters } from '@/api/routes/admin/roles';
import { AdminContext } from '@/state/admin';
import NewRoleButton from '@/components/admin/management/roles/NewRoleButton';
import FlashMessageRender from '@/elements/FlashMessageRender';
import useFlash from '@/plugins/useFlash';
import { NavLink } from 'react-router-dom';
import tw from 'twin.macro';
import AdminContentBlock from '@/elements/AdminContentBlock';
import AdminTable, {
    TableBody,
    TableHead,
    TableHeader,
    TableRow,
    Pagination,
    Loading,
    NoItems,
    ContentWrapper,
    useTableHooks,
} from '@/elements/AdminTable';
import CopyOnClick from '@/elements/CopyOnClick';
import { useStoreState } from '@/state/hooks';

/** Derive the unique groups a role has access to, e.g. ["servers","users","billing"] */
const getGrantedGroups = (permissions: string[]): string[] => {
    const groups = new Set(permissions.map(p => p.split('.')[0]));
    return Array.from(groups).sort();
};

const formatLabel = (s: string) =>
    s
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

const RolesContainer = () => {
    const { page, setPage, setFilters, sort, setSort, sortDirection } = useContext(RolesContext);
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const { data: roles, error, isValidating } = getRoles();

    const { colors } = useStoreState(state => state.theme.data!);

    useEffect(() => {
        if (!error) {
            clearFlashes('roles');
            return;
        }

        clearAndAddHttpError({ key: 'roles', error });
    }, [error]);

    const length = roles?.items?.length || 0;

    const setSelectedRoles = AdminContext.useStoreActions(actions => actions.roles.setSelectedRoles);

    const onSearch = (query: string): Promise<void> => {
        return new Promise(resolve => {
            if (query.length < 2) {
                setFilters(null);
            } else {
                setFilters({ name: query });
            }
            return resolve();
        });
    };

    useEffect(() => {
        setSelectedRoles([]);
    }, [page]);

    return (
        <AdminContentBlock title={'Roles'}>
            <div css={tw`w-full flex flex-col gap-2 sm:flex-row sm:items-center mb-8`}>
                <div css={tw`flex flex-col flex-shrink`} style={{ minWidth: '0' }}>
                    <h2 css={tw`text-2xl text-neutral-50 font-header font-medium`}>Administrator Roles</h2>
                    <p css={tw`text-base text-neutral-400 whitespace-nowrap overflow-ellipsis overflow-hidden`}>
                        Roles are sets of permissions that you can assign to your panel administrators.
                    </p>
                </div>

                <div css={tw`flex ml-auto pl-4`}>
                    <NewRoleButton />
                </div>
            </div>

            <FlashMessageRender byKey={'roles'} css={tw`mb-4`} />

            <AdminTable>
                <ContentWrapper onSearch={onSearch}>
                    <Pagination data={roles} onPageSelect={setPage}>
                        <div css={tw`overflow-x-auto`}>
                            <table css={tw`w-full table-auto`}>
                                <TableHead>
                                    <TableHeader
                                        name={'ID'}
                                        direction={sort === 'id' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('id')}
                                    />
                                    <TableHeader
                                        name={'Name'}
                                        direction={sort === 'name' ? (sortDirection ? 1 : 2) : null}
                                        onClick={() => setSort('name')}
                                    />
                                    <TableHeader name={'Description'} />
                                    <TableHeader name={'Access'} />
                                </TableHead>

                                <TableBody>
                                    {roles !== undefined &&
                                        !error &&
                                        !isValidating &&
                                        length > 0 &&
                                        roles.items.map(role => {
                                            const groups = getGrantedGroups(role.permissions);
                                            return (
                                                <TableRow key={role.id}>
                                                    <td
                                                        css={tw`px-6 text-sm text-neutral-200 text-left whitespace-nowrap`}
                                                    >
                                                        <CopyOnClick text={role.id.toString()}>
                                                            <code css={tw`font-mono bg-neutral-900 rounded py-1 px-2`}>
                                                                {role.id}
                                                            </code>
                                                        </CopyOnClick>
                                                    </td>

                                                    <td
                                                        css={tw`px-6 text-sm text-neutral-200 text-left whitespace-nowrap`}
                                                    >
                                                        <NavLink
                                                            to={`${window.location.pathname}/${role.id}`}
                                                            style={{ color: role.color ?? colors.primary }}
                                                            className={'duration-300 hover:brightness-125'}
                                                        >
                                                            {role.name}
                                                        </NavLink>
                                                    </td>

                                                    <td css={tw`px-6 text-sm text-neutral-400 text-left`}>
                                                        {role.description || (
                                                            <span css={tw`italic`}>No description</span>
                                                        )}
                                                    </td>

                                                    <td css={tw`px-6 py-3 text-sm text-left`}>
                                                        {groups.length === 0 ? (
                                                            <span css={tw`text-neutral-500 italic text-xs`}>
                                                                No permissions
                                                            </span>
                                                        ) : (
                                                            <div className={'flex flex-wrap gap-1'}>
                                                                {groups.map(g => (
                                                                    <span
                                                                        key={g}
                                                                        className={
                                                                            'text-xs px-2 py-0.5 rounded border border-neutral-600 text-neutral-300'
                                                                        }
                                                                    >
                                                                        {formatLabel(g)}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </td>
                                                </TableRow>
                                            );
                                        })}
                                </TableBody>
                            </table>

                            {roles === undefined || (error && isValidating) ? (
                                <Loading />
                            ) : length < 1 ? (
                                <NoItems />
                            ) : null}
                        </div>
                    </Pagination>
                </ContentWrapper>
            </AdminTable>
        </AdminContentBlock>
    );
};

export default () => {
    const hooks = useTableHooks<Filters>();

    return (
        <RolesContext.Provider value={hooks}>
            <RolesContainer />
        </RolesContext.Provider>
    );
};
