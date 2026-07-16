import { Form, Formik } from 'formik';
import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import tw from 'twin.macro';
import AdminBox from '@/elements/AdminBox';
import Field from '@/elements/Field';
import { Button } from '@/elements/button';
import {
    createAlert,
    updateAlert,
    getAlerts,
    CreateAlertData,
    UpdateAlertData,
    AlertScope,
    UserTargeting,
    searchUsers,
    AlertUser,
} from '@/api/routes/admin/alerts';
import useFlash from '@/plugins/useFlash';
import FlashMessageRender from '@/elements/FlashMessageRender';
import Label from '@/elements/Label';
import Select from '@/elements/Select';
import { AlertType as AlertTypeEnum, AlertPosition } from '@/state/everest';
import Spinner from '@/elements/Spinner';
import SearchableSelect, { Option } from '@/elements/SearchableSelect';

interface FormValues {
    title: string;
    content: string;
    type: AlertTypeEnum;
    position: AlertPosition;
    scope: AlertScope;
    user_targeting: UserTargeting;
    enabled: boolean;
    dismissible: boolean;
    link: string;
    link_text: string;
    priority: number;
    start_at: string;
    end_at: string;
}

export default () => {
    const navigate = useNavigate();
    const { id } = useParams();
    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();
    const [loading, setLoading] = useState(!!id);
    const [selectedUsers, setSelectedUsers] = useState<AlertUser[]>([]);
    const [userSearchResults, setUserSearchResults] = useState<AlertUser[] | null>(null);
    const [initialValues, setInitialValues] = useState<FormValues>({
        title: '',
        content: '',
        type: 'info' as AlertTypeEnum,
        position: 'notification' as AlertPosition,
        scope: 'global' as AlertScope,
        user_targeting: 'all' as UserTargeting,
        enabled: true,
        dismissible: false,
        link: '',
        link_text: '',
        priority: 0,
        start_at: '',
        end_at: '',
    });

    useEffect(() => {
        if (id) {
            getAlerts()
                .then(alerts => {
                    const alert = alerts.find(a => a.id === parseInt(id));
                    if (alert) {
                        setInitialValues({
                            title: alert.title || '',
                            content: alert.content,
                            type: alert.type,
                            position: alert.position,
                            scope: alert.scope,
                            user_targeting: alert.user_targeting,
                            enabled: alert.enabled,
                            dismissible: alert.dismissible,
                            link: alert.link || '',
                            link_text: alert.link_text || '',
                            priority: alert.priority,
                            start_at: alert.start_at ? (alert.start_at.split('T')[0] ?? '') : '',
                            end_at: alert.end_at ? (alert.end_at.split('T')[0] ?? '') : '',
                        });

                        if (alert.users) {
                            setSelectedUsers(alert.users);
                        }
                    }
                    setLoading(false);
                })
                .catch(error => {
                    clearAndAddHttpError({ key: 'alert:form', error });
                    setLoading(false);
                });
        }
    }, [id]);

    const onSearchUsers = async (query: string) => {
        try {
            const users = await searchUsers(query);
            // Filter out already selected users
            const filteredUsers = users.filter(u => !selectedUsers.some(su => su.id === u.id));
            setUserSearchResults(filteredUsers);
        } catch {
            setUserSearchResults([]);
        }
    };

    const onSelectUser = (user: AlertUser | null) => {
        if (user && !selectedUsers.some(u => u.id === user.id)) {
            setSelectedUsers([...selectedUsers, user]);
        }
        setUserSearchResults(null);
    };

    const submit = (values: FormValues) => {
        clearFlashes();

        const data: CreateAlertData | UpdateAlertData = {
            title: values.title || undefined,
            content: values.content,
            type: values.type,
            position: values.position,
            scope: values.scope,
            user_targeting: values.user_targeting,
            user_ids: values.user_targeting === 'specific' ? selectedUsers.map(u => u.id) : undefined,
            enabled: values.enabled,
            dismissible: values.dismissible,
            link: values.link || undefined,
            link_text: values.link_text || undefined,
            priority: values.priority,
            start_at: values.start_at || undefined,
            end_at: values.end_at || undefined,
        };

        const promise = id ? updateAlert(parseInt(id), data) : createAlert(data as CreateAlertData);

        promise
            .then(() => {
                addFlash({
                    type: 'success',
                    key: 'alert:form',
                    message: `Alert ${id ? 'updated' : 'created'} successfully.`,
                });
                setTimeout(() => navigate('/admin/alerts'), 1000);
            })
            .catch(error => {
                clearAndAddHttpError({
                    key: 'alert:form',
                    error: error,
                });
            });
    };

    if (loading) {
        return (
            <div css={tw`flex justify-center items-center py-12`}>
                <Spinner size={'large'} />
            </div>
        );
    }

    return (
        <Formik onSubmit={submit} initialValues={initialValues} enableReinitialize>
            {({ values, setFieldValue }) => (
                <Form>
                    <FlashMessageRender byKey={'alert:form'} className={'mb-4'} />

                    <div css={tw`mb-6`}>
                        <Button.Text onClick={() => navigate('/admin/alerts')} css={tw`mb-4`}>
                            ← Back to Alerts
                        </Button.Text>
                        <h3 css={tw`text-2xl font-medium`}>{id ? 'Edit Alert' : 'Create Alert'}</h3>
                    </div>

                    <div css={tw`grid grid-cols-1 md:grid-cols-2 gap-6`}>
                        <AdminBox title={'Basic Information'}>
                            <div css={tw`space-y-4`}>
                                <div>
                                    <Label>Title (Optional)</Label>
                                    <Field id={'title'} name={'title'} type={'text'} />
                                    <p className={'mt-1 text-xs text-gray-400'}>
                                        Optional title for internal organization
                                    </p>
                                </div>
                                <div>
                                    <Label>Content *</Label>
                                    <Field id={'content'} name={'content'} type={'text'} />
                                    <p className={'mt-1 text-xs text-gray-400'}>
                                        The message that will be displayed to users
                                    </p>
                                </div>
                            </div>
                        </AdminBox>

                        <AdminBox title={'Appearance'}>
                            <div css={tw`space-y-4`}>
                                <div>
                                    <Label>Type *</Label>
                                    <Select
                                        onChange={e => setFieldValue('type', e.currentTarget.value)}
                                        value={values.type}
                                    >
                                        <option value={'success'}>Success (Green)</option>
                                        <option value={'info'}>Info (Blue)</option>
                                        <option value={'warning'}>Warning (Yellow)</option>
                                        <option value={'danger'}>Danger (Red)</option>
                                    </Select>
                                </div>
                                <div>
                                    <Label>Position *</Label>
                                    <Select
                                        onChange={e => setFieldValue('position', e.currentTarget.value)}
                                        value={values.position}
                                    >
                                        <option value={'notification'}>Notification (Alerts Page Only)</option>
                                        <option value={'top-center'}>Top Center Banner</option>
                                        <option value={'slide-out'}>Slide-out Card (Right Side)</option>
                                        <option value={'center'}>Center (Popup Dialog)</option>
                                    </Select>
                                    <p className={'mt-1 text-xs text-gray-400'}>
                                        {values.position === 'notification'
                                            ? 'Alert appears only in the alerts page - shown as unread notification'
                                            : 'Choose where and how the alert appears on pages'}
                                    </p>
                                </div>
                                {values.position !== 'notification' && (
                                    <div>
                                        <Label>Scope *</Label>
                                        <Select
                                            onChange={e => setFieldValue('scope', e.currentTarget.value)}
                                            value={values.scope}
                                        >
                                            <option value={'global'}>Global (All Pages)</option>
                                            <option value={'dashboard'}>Dashboard Only</option>
                                            <option value={'server'}>Server Pages Only</option>
                                            <option value={'billing'}>Billing Pages Only</option>
                                            <option value={'account'}>Account Pages Only</option>
                                            <option value={'admin'}>Admin Panel Only</option>
                                        </Select>
                                        <p className={'mt-1 text-xs text-gray-400'}>
                                            Choose where this alert should be displayed
                                        </p>
                                    </div>
                                )}
                                <div>
                                    <Label>Priority</Label>
                                    <Field id={'priority'} name={'priority'} type={'number'} />
                                    <p className={'mt-1 text-xs text-gray-400'}>
                                        Higher priority alerts appear first (default: 0)
                                    </p>
                                </div>
                            </div>
                        </AdminBox>

                        <AdminBox title={'Settings'}>
                            <div css={tw`space-y-4`}>
                                <div className={'flex items-center'}>
                                    <Field id={'enabled'} name={'enabled'} type={'checkbox'} checked={values.enabled} />
                                    <Label className={'ml-2 mb-0'}>Enabled</Label>
                                </div>
                                <div className={'flex items-center'}>
                                    <Field
                                        id={'dismissible'}
                                        name={'dismissible'}
                                        type={'checkbox'}
                                        checked={values.dismissible}
                                    />
                                    <Label className={'ml-2 mb-0'}>Dismissible by users</Label>
                                </div>
                                <p className={'text-xs text-gray-400'}>
                                    Users can view all past alerts by clicking the bell icon in the navigation bar
                                </p>
                            </div>
                        </AdminBox>

                        <AdminBox title={'Link (Optional)'}>
                            <div css={tw`space-y-4`}>
                                <div>
                                    <Label>Link URL</Label>
                                    <Field id={'link'} name={'link'} type={'text'} />
                                </div>
                                <div>
                                    <Label>Link Text</Label>
                                    <Field id={'link_text'} name={'link_text'} type={'text'} />
                                    <p className={'mt-1 text-xs text-gray-400'}>
                                        Text to display for the link (defaults to URL)
                                    </p>
                                </div>
                            </div>
                        </AdminBox>

                        <AdminBox title={'User Targeting'} className={'md:col-span-2'}>
                            <div css={tw`space-y-4`}>
                                <div>
                                    <Label>Target Users *</Label>
                                    <Select
                                        onChange={e => setFieldValue('user_targeting', e.currentTarget.value)}
                                        value={values.user_targeting}
                                    >
                                        <option value={'all'}>All Users</option>
                                        <option value={'specific'}>Specific Users Only</option>
                                    </Select>
                                    <p className={'mt-1 text-xs text-gray-400'}>
                                        Choose whether to show this alert to all users or specific users
                                    </p>
                                </div>

                                {values.user_targeting === 'specific' && (
                                    <>
                                        <SearchableSelect
                                            id={'user-search'}
                                            name={'user-search'}
                                            label={'Select Users'}
                                            placeholder={'Search by email or username...'}
                                            items={userSearchResults}
                                            selected={null}
                                            setSelected={() => {
                                                // Not used for multi-select
                                            }}
                                            setItems={setUserSearchResults}
                                            onSearch={onSearchUsers}
                                            onSelect={onSelectUser}
                                            getSelectedText={() => ''}
                                            nullable
                                        >
                                            {userSearchResults?.map(user => (
                                                <Option
                                                    key={user.id}
                                                    selectId={'user-search'}
                                                    id={user.id}
                                                    item={user}
                                                    active={false}
                                                >
                                                    {user.email} (@{user.username})
                                                </Option>
                                            ))}
                                        </SearchableSelect>

                                        {selectedUsers.length > 0 && (
                                            <div>
                                                <Label>Selected Users</Label>
                                                <div css={tw`flex flex-wrap gap-2`}>
                                                    {selectedUsers.map(user => (
                                                        <div
                                                            key={user.id}
                                                            css={tw`flex items-center gap-2 bg-neutral-700 px-3 py-1.5 rounded text-sm`}
                                                        >
                                                            <span>{user.email}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    setSelectedUsers(
                                                                        selectedUsers.filter(u => u.id !== user.id),
                                                                    )
                                                                }
                                                                css={tw`text-gray-400 hover:text-red-400 transition-colors`}
                                                            >
                                                                <svg
                                                                    css={tw`w-4 h-4`}
                                                                    xmlns="http://www.w3.org/2000/svg"
                                                                    viewBox="0 0 20 20"
                                                                    fill="currentColor"
                                                                >
                                                                    <path
                                                                        clipRule="evenodd"
                                                                        fillRule="evenodd"
                                                                        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                                                    />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                                <p className={'mt-2 text-xs text-gray-400'}>
                                                    {selectedUsers.length} user(s) selected
                                                </p>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </AdminBox>

                        <AdminBox title={'Schedule (Optional)'} className={'md:col-span-2'}>
                            <div css={tw`grid grid-cols-1 md:grid-cols-2 gap-4`}>
                                <div>
                                    <Label>Start Date</Label>
                                    <Field id={'start_at'} name={'start_at'} type={'date'} />
                                    <p className={'mt-1 text-xs text-gray-400'}>Alert will only show after this date</p>
                                </div>
                                <div>
                                    <Label>End Date</Label>
                                    <Field id={'end_at'} name={'end_at'} type={'date'} />
                                    <p className={'mt-1 text-xs text-gray-400'}>Alert will only show until this date</p>
                                </div>
                            </div>
                        </AdminBox>
                    </div>

                    <div css={tw`w-full flex flex-row items-center mt-6 gap-4`}>
                        <Button.Text onClick={() => navigate('/admin/alerts')}>Cancel</Button.Text>
                        <div css={tw`flex ml-auto`}>
                            <Button type="submit">{id ? 'Update Alert' : 'Create Alert'}</Button>
                        </div>
                    </div>
                </Form>
            )}
        </Formik>
    );
};
