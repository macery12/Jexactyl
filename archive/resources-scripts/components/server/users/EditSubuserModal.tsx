import { useContext, useEffect, useRef, useState } from 'react';
import { type Subuser } from '@definitions/server';
import { Form, Formik } from 'formik';
import { array, object, string } from 'yup';
import Field from '@/elements/Field';
import { Actions, useStoreActions, useStoreState } from 'easy-peasy';
import { ApplicationStore } from '@/state';
import { modifySubuser } from '@/api/routes/server/subusers';
import { ServerContext } from '@/state/server';
import FlashMessageRender from '@/elements/FlashMessageRender';
import Can from '@/elements/Can';
import { usePermissions } from '@/plugins/usePermissions';
import { useDeepCompareMemo } from '@/plugins/useDeepCompareMemo';
import tw from 'twin.macro';
import { Button } from '@/elements/button';
import asModal from '@/hoc/asModal';
import ModalContext from '@/elements/ModalContext';
import { useField } from 'formik';
import Checkbox from '@/elements/Checkbox';
import { useStoreState as useThemeState } from '@/state/hooks';

type Props = {
    subuser?: Subuser;
};

interface Values {
    email: string;
    permissions: string[];
}

// New compact permission toggle component
interface PermissionToggleProps {
    permission: string;
    disabled: boolean;
}

const PermissionToggle = ({ permission, disabled }: PermissionToggleProps) => {
    const [key = '', pkey = ''] = permission.split('.', 2);
    const permissions = useStoreState(state => state.permissions.data);
    const description = permissions[key]?.keys?.[pkey] || '';
    const { secondary } = useThemeState(state => state.theme.data!.colors);

    return (
        <label
            htmlFor={`permission_${permission}`}
            css={[
                tw`flex items-center gap-3 p-3 rounded-lg border border-neutral-700 transition-all cursor-pointer hover:border-neutral-500`,
                disabled && tw`opacity-50 cursor-not-allowed hover:border-neutral-700`,
            ]}
            style={{ backgroundColor: disabled ? 'transparent' : secondary }}
        >
            <Checkbox
                id={`permission_${permission}`}
                name={'permissions'}
                value={permission}
                css={tw`w-4 h-4`}
                disabled={disabled}
            />
            <div css={tw`flex-1 min-w-0`}>
                <p css={tw`text-sm font-medium text-neutral-200 capitalize`}>{pkey.replace(/_/g, ' ')}</p>
                {description && <p css={tw`text-xs text-neutral-400 mt-0.5 line-clamp-1`}>{description}</p>}
            </div>
        </label>
    );
};

// New collapsible permission category component
interface PermissionCategoryProps {
    title: string;
    description: string;
    permissions: string[];
    isEditable: boolean;
    editablePermissions: string[];
}

const PermissionCategory = ({
    title,
    description,
    permissions,
    isEditable,
    editablePermissions,
}: PermissionCategoryProps) => {
    const [isExpanded, setIsExpanded] = useState(false); // Changed from true to false
    const [{ value }, , { setValue }] = useField<string[]>('permissions');
    const { secondary } = useThemeState(state => state.theme.data!.colors);

    const categoryPermissions = permissions.map(p => {
        const [, pkey] = p.split('.', 2);
        return { key: p, name: pkey };
    });

    const selectedCount = categoryPermissions.filter(p => value.includes(p.key)).length;
    const allSelected = categoryPermissions.length > 0 && categoryPermissions.every(p => value.includes(p.key));
    const someSelected = selectedCount > 0 && !allSelected;

    const toggleAll = () => {
        if (allSelected) {
            setValue(value.filter(p => !permissions.includes(p)));
        } else {
            setValue([...value, ...permissions.filter(p => !value.includes(p))]);
        }
    };

    // Get list of permission names for preview
    const permissionNames = categoryPermissions.map(p => p.name!.replace(/_/g, ' ')).join(', ');

    return (
        <div css={tw`border border-neutral-700 rounded-lg overflow-hidden`}>
            {/* Category Header */}
            <div
                css={tw`flex items-center gap-3 p-4 bg-neutral-800 cursor-pointer select-none hover:bg-neutral-700 transition-colors`}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div css={tw`flex-1 min-w-0`}>
                    <div css={tw`flex items-center gap-2`}>
                        <h3 css={tw`text-base font-semibold text-neutral-100 capitalize`}>{title}</h3>
                        <span css={tw`text-xs text-neutral-400`}>
                            ({selectedCount}/{categoryPermissions.length})
                        </span>
                    </div>
                    {description && <p css={tw`text-xs text-neutral-400 mt-1`}>{description}</p>}
                    {/* Show permission names when collapsed */}
                    {!isExpanded && (
                        <p css={tw`text-xs text-neutral-500 mt-2 line-clamp-1 capitalize`}>{permissionNames}</p>
                    )}
                </div>
                <div css={tw`flex items-center gap-3`}>
                    {isEditable && (
                        <button
                            type="button"
                            css={tw`flex items-center gap-2 px-3 py-2 text-sm text-neutral-300 hover:text-neutral-100 bg-neutral-700 hover:bg-neutral-600 rounded transition-colors`}
                            onClick={e => {
                                e.stopPropagation();
                                toggleAll();
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={allSelected}
                                readOnly
                                css={tw`w-5 h-5 rounded pointer-events-none`}
                                ref={input => {
                                    if (input) {
                                        input.indeterminate = someSelected;
                                    }
                                }}
                            />
                            <span>Select All</span>
                        </button>
                    )}
                    <svg
                        css={[tw`w-5 h-5 text-neutral-400 transition-transform`, isExpanded && tw`rotate-180`]}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </div>

            {/* Category Content */}
            {isExpanded && (
                <div css={tw`p-4 grid grid-cols-1 md:grid-cols-2 gap-3`} style={{ backgroundColor: secondary }}>
                    {categoryPermissions.map(({ key: permission }) => (
                        <PermissionToggle
                            key={permission}
                            permission={permission}
                            disabled={!isEditable || editablePermissions.indexOf(permission) < 0}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const EditSubuserModal = ({ subuser }: Props) => {
    const ref = useRef<HTMLHeadingElement>(null);
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const appendSubuser = ServerContext.useStoreActions(actions => actions.subusers.appendSubuser);
    const { clearFlashes, clearAndAddHttpError } = useStoreActions(
        (actions: Actions<ApplicationStore>) => actions.flashes,
    );
    const { dismiss, setPropOverrides } = useContext(ModalContext);
    const { secondary, primary } = useThemeState(state => state.theme.data!.colors);

    const isRootAdmin = useStoreState(state => state.user.data!.rootAdmin);
    const permissions = useStoreState(state => state.permissions.data);
    // The currently logged in user's permissions. We're going to filter out any permissions
    // that they should not need.
    const loggedInPermissions = ServerContext.useStoreState(state => state.server.permissions);
    const [canEditUser] = usePermissions(subuser ? ['user.update'] : ['user.create']);

    // The permissions that can be modified by this user.
    const editablePermissions = useDeepCompareMemo(() => {
        const cleaned = Object.keys(permissions).map(key =>
            Object.keys(permissions[key]?.keys ?? {}).map(pkey => `${key}.${pkey}`),
        );

        const list: string[] = ([] as string[]).concat.apply([], Object.values(cleaned));

        if (isRootAdmin || (loggedInPermissions.length === 1 && loggedInPermissions[0] === '*')) {
            return list;
        }

        return list.filter(key => loggedInPermissions.indexOf(key) >= 0);
    }, [isRootAdmin, permissions, loggedInPermissions]);

    const submit = (values: Values) => {
        setPropOverrides({ showSpinnerOverlay: true });
        clearFlashes('user:edit');

        modifySubuser(uuid, values, subuser)
            .then(subuser => {
                appendSubuser(subuser);
                dismiss();
            })
            .catch(error => {
                console.error(error);
                setPropOverrides(null);
                clearAndAddHttpError({ key: 'user:edit', error });

                if (ref.current) {
                    ref.current.scrollIntoView();
                }
            });
    };

    useEffect(
        () => () => {
            clearFlashes('user:edit');
        },
        [],
    );

    return (
        <Formik
            onSubmit={submit}
            initialValues={
                {
                    email: subuser?.email || '',
                    permissions: subuser?.permissions || [],
                } as Values
            }
            validationSchema={object().shape({
                email: string()
                    .max(191, 'Username or email must not exceed 191 characters.')
                    .required('A valid username or email address must be provided.'),
                permissions: array().of(string()),
            })}
        >
            <Form>
                {/* Header */}
                <div css={tw`mb-6`}>
                    <h2 css={tw`text-2xl font-bold text-neutral-100`} ref={ref}>
                        {subuser ? `${canEditUser ? 'Edit' : 'View'} Subuser` : 'Add New Subuser'}
                    </h2>
                    <p css={tw`text-sm text-neutral-400 mt-1`}>
                        {subuser
                            ? `Manage permissions for ${subuser.email}`
                            : 'Invite an existing user as a subuser for this server'}
                    </p>
                </div>

                <FlashMessageRender byKey={'user:edit'} css={tw`mb-4`} />

                {/* Warning for non-admin users */}
                {!isRootAdmin && loggedInPermissions[0] !== '*' && (
                    <div
                        css={tw`mb-4 p-3 rounded-lg bg-opacity-10 border border-opacity-30`}
                        style={{ backgroundColor: `${primary}1A`, borderColor: `${primary}4D` }}
                    >
                        <p css={tw`text-xs`} style={{ color: primary }}>
                            <strong>Note:</strong> You can only assign permissions that you currently have.
                        </p>
                    </div>
                )}

                {/* User Input Field */}
                {!subuser && (
                    <div css={tw`mb-6 p-4 rounded-lg border border-neutral-700`} style={{ backgroundColor: secondary }}>
                        <Field
                            name={'email'}
                            label={'Username or Email'}
                            description={'Enter the username or email of an existing user to invite.'}
                        />
                    </div>
                )}

                {/* Permissions Section */}
                <div css={tw`mb-6`}>
                    <div css={tw`flex items-center justify-between mb-4`}>
                        <h3 css={tw`text-lg font-semibold text-neutral-100`}>Permissions</h3>
                        <p css={tw`text-xs text-neutral-400`}>
                            {Object.keys(permissions).filter(key => key !== 'websocket').length} categories
                        </p>
                    </div>

                    <div css={tw`space-y-3 max-h-[60vh] overflow-y-auto pr-2`}>
                        {Object.keys(permissions)
                            .filter(key => key !== 'websocket')
                            .map(key => (
                                <PermissionCategory
                                    key={`permission_${key}`}
                                    title={key}
                                    description={permissions[key]?.description || ''}
                                    permissions={Object.keys(permissions[key]?.keys ?? {}).map(
                                        pkey => `${key}.${pkey}`,
                                    )}
                                    isEditable={canEditUser ?? false}
                                    editablePermissions={editablePermissions}
                                />
                            ))}
                    </div>
                </div>

                {/* Submit Button */}
                <Can action={subuser ? 'user.update' : 'user.create'}>
                    <div css={tw`flex justify-end gap-3 pt-4 border-t border-neutral-700`}>
                        <Button type={'submit'} css={tw`px-6`}>
                            {subuser ? 'Save Changes' : 'Add Subuser'}
                        </Button>
                    </div>
                </Can>
            </Form>
        </Formik>
    );
};

export default asModal<Props>({
    top: false,
})(EditSubuserModal);
