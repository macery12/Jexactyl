import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getEmailLogs, getTemplateKeys, type EmailLog, type PaginatedResponse } from '@/api/routes/admin/email';
import useFlash from '@/plugins/useFlash';
import Spinner from '@/elements/Spinner';
import { Button } from '@/elements/button';
import Input from '@/elements/Input';
import Select from '@/elements/Select';
import tw from 'twin.macro';
import styled from 'styled-components';
import EmailLogDetailModal from './EmailLogDetailModal';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFilter } from '@fortawesome/free-solid-svg-icons';
import { useStoreState } from '@/state/hooks';
import { getEmailStatusPresentation } from './status';

const Table = styled.table`
    ${tw`w-full table-auto`}
`;

const Th = styled.th`
    ${tw`px-4 py-3 text-left text-xs font-medium text-neutral-400 uppercase tracking-wider border-b border-neutral-700`}
`;

const Td = styled.td`
    ${tw`px-4 py-3 text-sm border-b border-neutral-700`}
`;

const StatusBadge = styled.span<{ $tone: 'success' | 'danger' | 'warning' | 'neutral' }>`
    ${tw`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium`}
    ${props => props.$tone === 'success' && tw`bg-green-900 text-green-300`}
    ${props => props.$tone === 'danger' && tw`bg-red-900 text-red-300`}
    ${props => props.$tone === 'warning' && tw`bg-yellow-900 text-yellow-300`}
    ${props => props.$tone === 'neutral' && tw`bg-neutral-700 text-neutral-200`}
`;

const FilterContainer = styled.div<{ $background: string }>`
    ${tw`mb-6 p-4 rounded-lg border border-neutral-700`}
    background-color: ${({ $background }) => $background};
`;

const FilterGrid = styled.div`
    ${tw`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`}
`;

export default () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [loading, setLoading] = useState(true);
    const [logs, setLogs] = useState<PaginatedResponse<EmailLog> | null>(null);
    const [templateKeys, setTemplateKeys] = useState<string[]>([]);
    const [selectedLog, setSelectedLog] = useState<number | null>(null);
    const [showFilters, setShowFilters] = useState(true);
    const [recipientInput, setRecipientInput] = useState(searchParams.get('recipient') || '');
    const { addFlash } = useFlash();
    const recipientDebounceRef = useRef<NodeJS.Timeout | null>(null);
    const { colors } = useStoreState(state => state.theme.data!);

    // Filter states
    const [filters, setFilters] = useState<{
        status: string;
        template_key: string;
        recipient: string;
        only_failures: boolean;
        date_from: string;
        date_to: string;
        page: number;
    }>({
        status: searchParams.get('status') || '',
        template_key: searchParams.get('template_key') || '',
        recipient: searchParams.get('recipient') || '',
        only_failures: searchParams.get('only_failures') === 'true',
        date_from: searchParams.get('date_from') || '',
        date_to: searchParams.get('date_to') || '',
        page: parseInt(searchParams.get('page') || '1'),
    });

    useEffect(() => {
        loadData();
        loadTemplateKeys();
    }, [filters]);

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await getEmailLogs(filters as import('@/api/routes/admin/email').EmailLogFilters);
            setLogs(data);
        } catch (error: any) {
            addFlash({
                key: 'email:activity',
                type: 'error',
                message: error.message || 'Failed to load email logs',
            });
        } finally {
            setLoading(false);
        }
    };

    const loadTemplateKeys = async () => {
        try {
            const { template_keys } = await getTemplateKeys();
            setTemplateKeys(template_keys);
        } catch (error) {
            // Silently fail
        }
    };

    const handleRecipientChange = (value: string) => {
        setRecipientInput(value);

        // Clear existing timeout
        if (recipientDebounceRef.current) {
            clearTimeout(recipientDebounceRef.current);
        }

        // Set new timeout for 3 seconds
        recipientDebounceRef.current = setTimeout(() => {
            updateFilter('recipient', value);
        }, 3000);
    };

    useEffect(() => {
        // Cleanup on unmount
        return () => {
            if (recipientDebounceRef.current) {
                clearTimeout(recipientDebounceRef.current);
            }
        };
    }, []);

    const updateFilter = (key: string, value: any) => {
        const newFilters = { ...filters, [key]: value };
        // Reset to page 1 only when changing filters, not when changing page itself
        if (key !== 'page') {
            newFilters.page = 1;
        }
        setFilters(newFilters);

        // Update URL params
        const newParams = new URLSearchParams();
        Object.entries(newFilters).forEach(([k, v]) => {
            if (v !== '' && v !== false) {
                newParams.set(k, String(v));
            }
        });
        setSearchParams(newParams);
    };

    const clearFilters = () => {
        const newFilters = {
            status: '',
            template_key: '',
            recipient: '',
            only_failures: false,
            date_from: '',
            date_to: '',
            page: 1,
        };
        setFilters(newFilters);
        setRecipientInput('');
        setSearchParams(new URLSearchParams());
    };

    const quickDateRange = (days: number) => {
        const now = new Date();
        const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        const newFilters = {
            ...filters,
            date_from: from.toISOString().split('T')[0] ?? '',
            date_to: now.toISOString().split('T')[0] ?? '',
            page: 1,
        };
        setFilters(newFilters);

        // Update URL params
        const newParams = new URLSearchParams();
        Object.entries(newFilters).forEach(([k, v]) => {
            if (v !== '' && v !== false) {
                newParams.set(k, String(v));
            }
        });
        setSearchParams(newParams);
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString();
    };

    const goToPage = (page: number) => {
        updateFilter('page', page);
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold">Email Activity Log</h2>
                <Button onClick={() => setShowFilters(!showFilters)} variant="secondary" size="sm">
                    <FontAwesomeIcon icon={faFilter} className="mr-2" />
                    {showFilters ? 'Hide' : 'Show'} Filters
                </Button>
            </div>

            {showFilters && (
                <FilterContainer $background={colors.secondary}>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold">Filters</h3>
                        <Button onClick={clearFilters} variant="text" size="sm">
                            Clear All
                        </Button>
                    </div>

                    <FilterGrid>
                        <div>
                            <label className="block text-sm font-medium mb-1 text-neutral-400">Status</label>
                            <Select value={filters.status} onChange={e => updateFilter('status', e.target.value)}>
                                <option value="">All Statuses</option>
                                <option value="queued">Queued</option>
                                <option value="sending">Sending</option>
                                <option value="deferred">Deferred</option>
                                <option value="skipped">Skipped</option>
                                <option value="sent">Sent</option>
                                <option value="failed">Failed</option>
                            </Select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1 text-gray-400">Template</label>
                            <Select
                                value={filters.template_key}
                                onChange={e => updateFilter('template_key', e.target.value)}
                            >
                                <option value="">All Templates</option>
                                {templateKeys.map(key => (
                                    <option key={key} value={key}>
                                        {key}
                                    </option>
                                ))}
                            </Select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1 text-neutral-400">Recipient</label>
                            <Input
                                type="text"
                                placeholder="Search recipient..."
                                value={recipientInput}
                                onChange={e => handleRecipientChange(e.target.value)}
                            />
                            <p className="text-xs text-neutral-500 mt-1">
                                Auto-searches 3 seconds after you stop typing
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1 text-gray-400">Quick Date Range</label>
                            <div className="flex gap-2">
                                <Button onClick={() => quickDateRange(1)} variant="secondary" size="sm">
                                    24h
                                </Button>
                                <Button onClick={() => quickDateRange(7)} variant="secondary" size="sm">
                                    7d
                                </Button>
                                <Button onClick={() => quickDateRange(30)} variant="secondary" size="sm">
                                    30d
                                </Button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1 text-gray-400">Date From</label>
                            <Input
                                type="date"
                                value={filters.date_from}
                                onChange={e => updateFilter('date_from', e.target.value)}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1 text-gray-400">Date To</label>
                            <Input
                                type="date"
                                value={filters.date_to}
                                onChange={e => updateFilter('date_to', e.target.value)}
                            />
                        </div>

                        <div className="flex items-end">
                            <label className="flex items-center text-sm">
                                <Input
                                    type="checkbox"
                                    checked={filters.only_failures}
                                    onChange={e => updateFilter('only_failures', e.target.checked)}
                                    className="mr-2"
                                />
                                Only show failures
                            </label>
                        </div>
                    </FilterGrid>
                </FilterContainer>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <Spinner size="large" />
                </div>
            ) : logs && logs.data.length > 0 ? (
                <>
                    <div
                        className="bg-neutral-800 rounded-lg border border-neutral-700 overflow-hidden"
                        style={{ backgroundColor: colors.secondary, borderColor: colors.headers }}
                    >
                        <div className="overflow-x-auto">
                            <Table>
                                <thead>
                                    <tr>
                                        <Th>Status</Th>
                                        <Th>Timestamp</Th>
                                        <Th>Recipient</Th>
                                        <Th>Template</Th>
                                        <Th>Provider</Th>
                                        <Th>Attempts</Th>
                                        <Th>Actions</Th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.data.map(log => (
                                        <tr key={log.id} className="hover:bg-neutral-800 transition-colors">
                                            <Td>
                                                {(() => {
                                                    const status = getEmailStatusPresentation(log.status);

                                                    return (
                                                        <StatusBadge $tone={status.tone}>
                                                            <FontAwesomeIcon icon={status.icon} className="mr-1" />
                                                            {status.label}
                                                        </StatusBadge>
                                                    );
                                                })()}
                                            </Td>
                                            <Td className="text-gray-400">{formatDate(log.created_at)}</Td>
                                            <Td>
                                                <div className="flex items-center">
                                                    <span className="text-neutral-300">{log.to}</span>
                                                    {log.user && (
                                                        <span className="ml-2 text-xs text-gray-500">
                                                            ({log.user.username})
                                                        </span>
                                                    )}
                                                </div>
                                            </Td>
                                            <Td>
                                                <code className="text-xs bg-neutral-900 px-2 py-1 rounded text-neutral-300">
                                                    {log.template_key || 'custom'}
                                                </code>
                                            </Td>
                                            <Td>
                                                <span className="inline-flex items-center rounded-full bg-neutral-800 px-2 py-1 text-xs font-semibold text-neutral-200">
                                                    {log.provider ? log.provider.toUpperCase() : 'UNKNOWN'}
                                                </span>
                                            </Td>
                                            <Td>
                                                <span
                                                    className={
                                                        log.attempt_count > 1 ? 'text-yellow-400' : 'text-gray-400'
                                                    }
                                                >
                                                    {log.attempt_count}
                                                </span>
                                            </Td>
                                            <Td>
                                                <Button
                                                    onClick={() => setSelectedLog(log.id)}
                                                    variant="secondary"
                                                    size="sm"
                                                >
                                                    View Details
                                                </Button>
                                            </Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        </div>
                    </div>

                    {/* Pagination */}
                    {logs.last_page > 1 && (
                        <div className="flex items-center justify-center gap-2 mt-6">
                            <Button
                                onClick={() => goToPage(filters.page - 1)}
                                disabled={filters.page === 1}
                                variant="secondary"
                                size="sm"
                            >
                                Previous
                            </Button>
                            <span className="text-sm text-gray-400">
                                Page {logs.current_page} of {logs.last_page}
                            </span>
                            <Button
                                onClick={() => goToPage(filters.page + 1)}
                                disabled={filters.page === logs.last_page}
                                variant="secondary"
                                size="sm"
                            >
                                Next
                            </Button>
                        </div>
                    )}
                </>
            ) : (
                <div
                    className="bg-neutral-800 rounded-lg border border-neutral-700 py-12 text-center"
                    style={{ backgroundColor: colors.secondary, borderColor: colors.headers }}
                >
                    <p className="text-gray-400 text-lg">No email logs found</p>
                    <p className="text-gray-500 text-sm mt-2">Try adjusting your filters</p>
                </div>
            )}

            {selectedLog !== null && (
                <EmailLogDetailModal key={selectedLog} logId={selectedLog} onClose={() => setSelectedLog(null)} />
            )}
        </div>
    );
};
