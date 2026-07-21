import { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faSlidersH,
    faChevronDown,
    faChevronRight,
    faSearch,
    faPlus,
    faMinus,
    faUndo,
    faTimes,
    faSpinner,
    faExclamationTriangle,
    faHeart,
    faRunning,
    faCog,
    faArrowsAlt,
    faShieldAlt,
    faFistRaised,
} from '@fortawesome/free-solid-svg-icons';
import { useStoreState } from '@/state/hooks';
import {
    getServerVersion,
    getAttributes,
    setAttribute,
    resetAttribute,
    ServerVersion,
    AttributeCategory,
    AttributeInfo,
} from '@/api/server/extensions/playerManager';
import Modal from '@/elements/Modal';
import useFlash from '@/plugins/useFlash';
import FlashMessageRender from '@/elements/FlashMessageRender';

// Get persisted collapsed categories from localStorage
const getPersistedCollapsed = (): string[] => {
    try {
        const stored = localStorage.getItem('playerManager:collapsedCategories');
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
};

const setPersistedCollapsed = (categories: string[]) => {
    try {
        localStorage.setItem('playerManager:collapsedCategories', JSON.stringify(categories));
    } catch {
        // Ignore storage errors
    }
};

const getCategoryIcon = (category: string) => {
    const lower = category.toLowerCase();
    if (lower.includes('health') || lower.includes('defense')) return faHeart;
    if (lower.includes('combat')) return faFistRaised;
    if (lower.includes('movement')) return faRunning;
    if (lower.includes('reach')) return faArrowsAlt;
    if (lower.includes('physics')) return faCog;
    return faShieldAlt;
};

interface AttributeRowProps {
    attribute: AttributeInfo;
    serverUuid: string;
    playerName: string;
    onSuccess: () => void;
    disabled: boolean;
}

const AttributeRow = ({ attribute, serverUuid, playerName, onSuccess, disabled }: AttributeRowProps) => {
    const [value, setValue] = useState(attribute.default);
    const [loading, setLoading] = useState(false);
    const { addFlash, clearAndAddHttpError } = useFlash();

    const handleSetValue = async (newValue: number) => {
        if (disabled) return;
        // Clamp to min/max
        const clampedValue = Math.max(attribute.min, Math.min(attribute.max, newValue));
        setValue(clampedValue);

        setLoading(true);
        try {
            const response = await setAttribute(serverUuid, playerName, attribute.id, clampedValue);
            if (response.success) {
                addFlash({
                    key: 'server:player-manager:attributes',
                    type: 'success',
                    message: `Set ${attribute.name} to ${clampedValue}`,
                });
                onSuccess();
            } else {
                throw new Error(response.error);
            }
        } catch (error: any) {
            clearAndAddHttpError({ key: 'server:player-manager:attributes', error });
        } finally {
            setLoading(false);
        }
    };

    const handleReset = async () => {
        if (disabled) return;
        setLoading(true);
        try {
            const response = await resetAttribute(serverUuid, playerName, attribute.id);
            if (response.success) {
                setValue(response.defaultValue || attribute.default);
                addFlash({
                    key: 'server:player-manager:attributes',
                    type: 'success',
                    message: `Reset ${attribute.name} to default`,
                });
                onSuccess();
            } else {
                throw new Error(response.error);
            }
        } catch (error: any) {
            clearAndAddHttpError({ key: 'server:player-manager:attributes', error });
        } finally {
            setLoading(false);
        }
    };

    const getIncrement = () => {
        const range = attribute.max - attribute.min;
        if (range <= 2) return 0.1;
        if (range <= 20) return 1;
        if (range <= 100) return 5;
        return 10;
    };

    const increment = getIncrement();

    return (
        <div className="flex items-center gap-4 rounded-lg bg-zinc-800 p-3 hover:bg-neutral-700 transition-colors">
            <div className="flex-1 min-w-0">
                <div className="font-medium text-white truncate">{attribute.name}</div>
                <div className="text-xs text-neutral-500 truncate" title={attribute.description}>
                    {attribute.description}
                </div>
            </div>

            <div className="flex items-center gap-2">
                {/* Decrement button */}
                <button
                    onClick={() => handleSetValue(value - increment)}
                    disabled={disabled || loading || value <= attribute.min}
                    className="w-8 h-8 rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-neutral-300 transition-colors"
                    title={`-${increment}`}
                >
                    <FontAwesomeIcon icon={faMinus} className="text-sm" />
                </button>

                {/* Value input */}
                <input
                    type="number"
                    value={value}
                    onChange={e => setValue(parseFloat(e.target.value) || 0)}
                    onBlur={() => handleSetValue(value)}
                    onKeyDown={e => e.key === 'Enter' && handleSetValue(value)}
                    disabled={disabled || loading}
                    min={attribute.min}
                    max={attribute.max}
                    step={increment}
                    className="w-20 rounded bg-neutral-700 px-2 py-1 text-center text-white text-sm border border-neutral-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                />

                {/* Increment button */}
                <button
                    onClick={() => handleSetValue(value + increment)}
                    disabled={disabled || loading || value >= attribute.max}
                    className="w-8 h-8 rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-neutral-300 transition-colors"
                    title={`+${increment}`}
                >
                    <FontAwesomeIcon icon={faPlus} className="text-sm" />
                </button>

                {/* Reset button */}
                <button
                    onClick={handleReset}
                    disabled={disabled || loading}
                    className="w-8 h-8 rounded bg-neutral-700 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-neutral-300 transition-colors"
                    title={`Reset to ${attribute.default}`}
                >
                    {loading ? (
                        <FontAwesomeIcon icon={faSpinner} spin className="text-sm" />
                    ) : (
                        <FontAwesomeIcon icon={faUndo} className="text-sm" />
                    )}
                </button>
            </div>

            {/* Range indicator */}
            <div className="hidden sm:block text-xs text-neutral-500 w-24 text-right">
                {attribute.min} - {attribute.max}
            </div>
        </div>
    );
};

interface CategorySectionProps {
    category: AttributeCategory;
    collapsed: boolean;
    onToggle: () => void;
    searchQuery: string;
    serverUuid: string;
    playerName: string;
    onSuccess: () => void;
    disabled: boolean;
}

const CategorySection = ({
    category,
    collapsed,
    onToggle,
    searchQuery,
    serverUuid,
    playerName,
    onSuccess,
    disabled,
}: CategorySectionProps) => {
    const primary = useStoreState(state => state.theme.data!.colors.primary);

    // Filter attributes by search query
    const filteredAttributes = searchQuery
        ? category.attributes.filter(
              attr =>
                  attr.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  attr.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  attr.description.toLowerCase().includes(searchQuery.toLowerCase()),
          )
        : category.attributes;

    if (filteredAttributes.length === 0) {
        return null;
    }

    return (
        <div className="rounded-lg bg-zinc-800 overflow-hidden">
            {/* Category Header */}
            <button
                onClick={onToggle}
                className="w-full flex items-center justify-between px-4 py-3 bg-zinc-700 hover:bg-zinc-600 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <FontAwesomeIcon icon={getCategoryIcon(category.category)} style={{ color: primary }} />
                    <span className="font-semibold text-white">{category.category}</span>
                    <span className="text-xs text-neutral-500 bg-neutral-700 px-2 py-0.5 rounded">
                        {filteredAttributes.length}
                    </span>
                </div>
                <FontAwesomeIcon icon={collapsed ? faChevronRight : faChevronDown} className="text-neutral-400" />
            </button>

            {/* Attributes List */}
            {!collapsed && (
                <div className="p-2 space-y-2">
                    {filteredAttributes.map(attr => (
                        <AttributeRow
                            key={attr.id}
                            attribute={attr}
                            serverUuid={serverUuid}
                            playerName={playerName}
                            onSuccess={onSuccess}
                            disabled={disabled}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

interface AttributeEditorProps {
    visible: boolean;
    onDismissed: () => void;
    onBack?: () => void;
    serverUuid: string;
    playerName: string;
    isOnline: boolean;
    canManage: boolean;
}

const AttributeEditor = ({
    visible,
    onDismissed,
    onBack,
    serverUuid,
    playerName,
    isOnline,
    canManage,
}: AttributeEditorProps) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [version, setVersion] = useState<ServerVersion | null>(null);
    const [categories, setCategories] = useState<AttributeCategory[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedCategories, setCollapsedCategories] = useState<string[]>(getPersistedCollapsed);
    const primary = useStoreState(state => state.theme.data!.colors.primary);

    const fetchData = useCallback(async () => {
        if (!serverUuid) return;

        setLoading(true);
        setError(null);

        try {
            // First check server version
            const versionResponse = await getServerVersion(serverUuid);
            if (!versionResponse.success || !versionResponse.version) {
                throw new Error(versionResponse.error || 'Failed to detect server version');
            }

            setVersion(versionResponse.version);

            if (!versionResponse.version.supportsAttributes) {
                setError(
                    `Attributes require Minecraft 1.16 or higher. Detected version: ${versionResponse.version.raw}`,
                );
                setLoading(false);
                return;
            }

            // Fetch available attributes
            const attributesResponse = await getAttributes(serverUuid);
            if (!attributesResponse.success || !attributesResponse.attributes) {
                throw new Error(attributesResponse.error || 'Failed to load attributes');
            }

            setCategories(attributesResponse.attributes);
        } catch (err: any) {
            setError(err.message || 'Failed to load attribute editor');
        } finally {
            setLoading(false);
        }
    }, [serverUuid]);

    useEffect(() => {
        if (visible) {
            fetchData();
        }
    }, [visible, fetchData]);

    const toggleCategory = (categoryName: string) => {
        setCollapsedCategories(prev => {
            const newCollapsed = prev.includes(categoryName)
                ? prev.filter(c => c !== categoryName)
                : [...prev, categoryName];
            setPersistedCollapsed(newCollapsed);
            return newCollapsed;
        });
    };

    const handleSuccess = () => {
        // Could refresh data here if needed
    };

    // Filter categories that have matching attributes
    const visibleCategories = searchQuery
        ? categories.filter(cat =>
              cat.attributes.some(
                  attr =>
                      attr.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      attr.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      attr.description.toLowerCase().includes(searchQuery.toLowerCase()),
              ),
          )
        : categories;

    return (
        <Modal visible={visible} onDismissed={onDismissed} closeOnBackground>
            <div className="max-h-[85vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between mb-4 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <FontAwesomeIcon icon={faSlidersH} style={{ color: primary }} className="text-xl" />
                        <div>
                            <h2 className="text-xl font-semibold text-white">Attribute Editor</h2>
                            <p className="text-sm text-neutral-400">
                                Editing {playerName}
                                {version && (
                                    <span className="ml-2 text-xs bg-neutral-700 px-2 py-0.5 rounded">
                                        {version.raw}
                                    </span>
                                )}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            onDismissed();
                            if (onBack) onBack();
                        }}
                        className="p-2 text-neutral-400 hover:text-white transition-colors"
                    >
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>

                <FlashMessageRender byKey="server:player-manager:attributes" className="mb-4 flex-shrink-0" />

                {!isOnline && (
                    <div className="mb-4 rounded-lg border border-amber-600/40 bg-amber-500/10 p-3 text-sm text-amber-300">
                        This player is offline. Attribute changes are unavailable until they are online.
                    </div>
                )}
                {!canManage && (
                    <div className="mb-4 rounded-lg border border-neutral-600/40 bg-neutral-500/10 p-3 text-sm text-neutral-300">
                        You have read-only access. Attribute changes are disabled.
                    </div>
                )}

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <FontAwesomeIcon icon={faSpinner} spin className="text-3xl text-neutral-500" />
                    </div>
                ) : error ? (
                    <div className="text-center py-8">
                        <FontAwesomeIcon icon={faExclamationTriangle} className="text-4xl text-amber-500 mb-4" />
                        <p className="text-red-400">{error}</p>
                    </div>
                ) : (
                    <>
                        {/* Search Bar */}
                        <div className="relative mb-4 flex-shrink-0">
                            <FontAwesomeIcon
                                icon={faSearch}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500"
                            />
                            <input
                                type="text"
                                placeholder="Search attributes..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full rounded-lg bg-zinc-800 border border-neutral-600 pl-10 pr-4 py-2 text-white placeholder-neutral-500 focus:border-neutral-500 focus:outline-none"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
                                >
                                    <FontAwesomeIcon icon={faTimes} />
                                </button>
                            )}
                        </div>

                        {/* Collapse All / Expand All */}
                        <div className="flex gap-2 mb-4 flex-shrink-0">
                            <button
                                onClick={() => {
                                    const allCategories = categories.map(c => c.category);
                                    setCollapsedCategories(allCategories);
                                    setPersistedCollapsed(allCategories);
                                }}
                                className="text-xs text-neutral-400 hover:text-white transition-colors"
                            >
                                Collapse All
                            </button>
                            <span className="text-neutral-600">|</span>
                            <button
                                onClick={() => {
                                    setCollapsedCategories([]);
                                    setPersistedCollapsed([]);
                                }}
                                className="text-xs text-neutral-400 hover:text-white transition-colors"
                            >
                                Expand All
                            </button>
                        </div>

                        {/* Categories */}
                        <div className="space-y-3 overflow-y-auto flex-1 pr-1">
                            {visibleCategories.length === 0 ? (
                                <div className="text-center py-8 text-neutral-500">No attributes match your search</div>
                            ) : (
                                visibleCategories.map(category => (
                                    <CategorySection
                                        key={category.category}
                                        category={category}
                                        collapsed={collapsedCategories.includes(category.category)}
                                        onToggle={() => toggleCategory(category.category)}
                                        searchQuery={searchQuery}
                                        serverUuid={serverUuid}
                                        playerName={playerName}
                                        onSuccess={handleSuccess}
                                        disabled={!isOnline || !canManage}
                                    />
                                ))
                            )}
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
};

export default AttributeEditor;
