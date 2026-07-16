import { useState, useEffect } from 'react';
import { Alert as AlertType, getAlerts, deleteAlert } from '@/api/routes/admin/alerts';
import AdminBox from '@/elements/AdminBox';
import useFlash from '@/plugins/useFlash';
import tw from 'twin.macro';
import { Button } from '@/elements/button';
import { faPlus, faTrash, faEdit, faToggleOn, faToggleOff } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Dialog } from '@/elements/dialog';
import { useNavigate } from 'react-router-dom';
import Spinner from '@/elements/Spinner';

const AlertTypeColors = {
    success: 'bg-green-500',
    info: 'bg-blue-500',
    warning: 'bg-yellow-500',
    danger: 'bg-red-500',
};

export default () => {
    const navigate = useNavigate();
    const { addFlash, clearAndAddHttpError } = useFlash();
    const [alerts, setAlerts] = useState<AlertType[]>([]);
    const [loading, setLoading] = useState(true);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [alertToDelete, setAlertToDelete] = useState<AlertType | null>(null);

    const loadAlerts = () => {
        setLoading(true);
        getAlerts()
            .then(data => {
                setAlerts(data);
                setLoading(false);
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'alerts:list', error });
                setLoading(false);
            });
    };

    useEffect(() => {
        loadAlerts();
    }, []);

    const handleDelete = (alert: AlertType) => {
        setAlertToDelete(alert);
        setDeleteDialogOpen(true);
    };

    const confirmDelete = () => {
        if (!alertToDelete) return;

        deleteAlert(alertToDelete.id)
            .then(() => {
                addFlash({
                    type: 'success',
                    key: 'alerts:list',
                    message: 'Alert deleted successfully.',
                });
                loadAlerts();
                setDeleteDialogOpen(false);
                setAlertToDelete(null);
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'alerts:list', error });
                setDeleteDialogOpen(false);
            });
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString();
    };

    return (
        <>
            <Dialog.Confirm
                open={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}
                title={'Delete Alert'}
                onConfirmed={confirmDelete}
            >
                Are you sure you want to delete this alert? This action cannot be undone.
            </Dialog.Confirm>

            <div css={tw`mb-4 flex justify-between items-center`}>
                <h3 css={tw`text-xl font-medium`}>Alert Management</h3>
                <Button onClick={() => navigate('/admin/alerts/create')}>
                    <FontAwesomeIcon icon={faPlus} css={tw`mr-2`} />
                    Create Alert
                </Button>
            </div>

            {loading ? (
                <div css={tw`flex justify-center items-center py-12`}>
                    <Spinner size={'large'} />
                </div>
            ) : alerts.length === 0 ? (
                <AdminBox title={'No Alerts'}>
                    <p css={tw`text-gray-400 text-center py-8`}>
                        No alerts have been created yet. Click "Create Alert" to get started.
                    </p>
                </AdminBox>
            ) : (
                <div css={tw`space-y-4`}>
                    {alerts.map(alert => (
                        <AdminBox key={alert.id} title={alert.title || `Alert #${alert.id}`}>
                            <div css={tw`flex items-start justify-between`}>
                                <div css={tw`flex-1`}>
                                    <div css={tw`flex items-center gap-2 mb-2`}>
                                        <span
                                            css={tw`inline-block w-3 h-3 rounded-full`}
                                            className={AlertTypeColors[alert.type]}
                                        />
                                        <span css={tw`text-sm font-medium capitalize`}>{alert.type}</span>
                                        <span css={tw`text-xs text-gray-500`}>|</span>
                                        <span css={tw`text-sm text-gray-400 capitalize`}>
                                            {alert.position.replace('-', ' ')}
                                        </span>
                                        <span css={tw`text-xs text-gray-500`}>|</span>
                                        <span
                                            css={tw`text-sm text-gray-400 capitalize bg-gray-700 px-2 py-0.5 rounded`}
                                        >
                                            {alert.scope}
                                        </span>
                                        <span css={tw`text-xs text-gray-500`}>|</span>
                                        <span css={tw`text-sm text-gray-400`}>Priority: {alert.priority}</span>
                                        <FontAwesomeIcon
                                            icon={alert.enabled ? faToggleOn : faToggleOff}
                                            css={tw`ml-2`}
                                            className={alert.enabled ? 'text-green-500' : 'text-gray-500'}
                                        />
                                    </div>
                                    <p css={tw`text-gray-300 mb-2`}>{alert.content}</p>
                                    {alert.link && (
                                        <p css={tw`text-sm text-blue-400 mb-2`}>
                                            Link: {alert.link_text || alert.link}
                                        </p>
                                    )}
                                    <div css={tw`flex gap-4 text-xs text-gray-500`}>
                                        {alert.start_at && <span>Start: {formatDate(alert.start_at)}</span>}
                                        {alert.end_at && <span>End: {formatDate(alert.end_at)}</span>}
                                        {alert.dismissible && <span>Dismissible</span>}
                                        {alert.show_button && <span>Has Reopen Button</span>}
                                    </div>
                                </div>
                                <div css={tw`flex gap-2 ml-4`}>
                                    <Button.Text
                                        onClick={() => navigate(`/admin/alerts/edit/${alert.id}`)}
                                        css={tw`px-3 py-2`}
                                    >
                                        <FontAwesomeIcon icon={faEdit} />
                                    </Button.Text>
                                    <Button.Danger onClick={() => handleDelete(alert)} css={tw`px-3 py-2`}>
                                        <FontAwesomeIcon icon={faTrash} />
                                    </Button.Danger>
                                </div>
                            </div>
                        </AdminBox>
                    ))}
                </div>
            )}
        </>
    );
};
