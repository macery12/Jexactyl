import { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faBox,
    faLocationDot,
    faShield,
    faHeart,
    faDrumstickBite,
    faStar,
    faGamepad,
    faTimes,
    faSpinner,
    faBoxesStacked,
} from '@fortawesome/free-solid-svg-icons';
import { useStoreState } from '@/state/hooks';
import {
    getPlayerData,
    PlayerDataResponse,
    InventoryItem,
    PlayerArmor,
    PlayerLocation,
    PlayerStats,
} from '@/api/server/extensions/playerManager';
import Modal from '@/elements/Modal';

interface ItemTooltipProps {
    item: InventoryItem;
    position: { x: number; y: number };
}

// Enchantments that only have one level (don't show roman numeral)
const SINGLE_LEVEL_ENCHANTS = [
    'Mending',
    'Aqua Affinity',
    'Curse of Binding',
    'Curse of Vanishing',
    'Multishot',
    'Silk Touch',
    'Flame',
    'Infinity',
    'Channeling',
];

// Format enchantment display - hide roman numeral for single-level enchants
const formatEnchant = (name: string, levelRoman: string): string => {
    if (SINGLE_LEVEL_ENCHANTS.includes(name)) {
        return name;
    }
    return `${name} ${levelRoman}`;
};

const ItemTooltip = ({ item, position }: ItemTooltipProps) => {
    const isContainer = item.contents && item.contents.length > 0;
    const isEnchantedBook =
        item.id === 'minecraft:enchanted_book' && item.storedEnchantments && item.storedEnchantments.length > 0;

    // Helper to format an item's display name with enchants for container contents
    const formatContainerItem = (contentItem: InventoryItem): string => {
        // For enchanted books, show the stored enchantment instead of "Enchanted Book"
        if (
            contentItem.id === 'minecraft:enchanted_book' &&
            contentItem.storedEnchantments &&
            contentItem.storedEnchantments.length > 0
        ) {
            return contentItem.storedEnchantments.map(e => formatEnchant(e.name, e.levelRoman)).join(', ');
        }

        // For other items with enchantments, show item name + enchants
        if (contentItem.enchantments && contentItem.enchantments.length > 0) {
            const enchantStr = contentItem.enchantments.map(e => formatEnchant(e.name, e.levelRoman)).join(', ');
            return `${contentItem.customName || contentItem.name} (${enchantStr})`;
        }

        return contentItem.customName || contentItem.name;
    };

    // Group container items by their formatted display name
    const groupContainerItems = (
        contents: InventoryItem[],
    ): { name: string; count: number; isEnchantedBook: boolean }[] => {
        const groups: Record<string, { count: number; isEnchantedBook: boolean }> = {};

        contents.forEach(contentItem => {
            const displayName = formatContainerItem(contentItem);
            const isBook = contentItem.id === 'minecraft:enchanted_book';

            if (groups[displayName]) {
                groups[displayName].count += contentItem.count;
            } else {
                groups[displayName] = { count: contentItem.count, isEnchantedBook: isBook };
            }
        });

        return Object.entries(groups).map(([name, data]) => ({
            name,
            count: data.count,
            isEnchantedBook: data.isEnchantedBook,
        }));
    };

    const groupedContents = isContainer ? groupContainerItems(item.contents) : [];

    return (
        <div
            className="pointer-events-none fixed z-[100] max-w-xs rounded-lg bg-neutral-900 p-3 shadow-xl border border-neutral-700"
            style={{
                left: position.x + 10,
                top: position.y + 10,
            }}
        >
            {/* Item Name */}
            <div className="font-semibold text-white">
                {item.customName || item.name}
                {item.count > 1 && <span className="ml-1 text-neutral-400">x{item.count}</span>}
            </div>

            {/* Item ID */}
            <div className="text-xs text-neutral-500">{item.id}</div>

            {/* Enchantments */}
            {item.enchantments && item.enchantments.length > 0 && (
                <div className="mt-2 space-y-0.5">
                    {item.enchantments.map((ench, idx) => (
                        <div key={idx} className="text-sm text-purple-400">
                            {formatEnchant(ench.name, ench.levelRoman)}
                        </div>
                    ))}
                </div>
            )}

            {/* Stored Enchantments (for enchanted books) */}
            {isEnchantedBook && (
                <div className="mt-2 space-y-0.5">
                    {item.storedEnchantments.map((ench, idx) => (
                        <div key={idx} className="text-sm text-purple-400">
                            {formatEnchant(ench.name, ench.levelRoman)}
                        </div>
                    ))}
                </div>
            )}

            {/* Durability */}
            {item.durability && (
                <div className="mt-2">
                    <div className="text-xs text-neutral-400">
                        Durability: {item.durability.current}/{item.durability.max}
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded bg-neutral-700">
                        <div
                            className="h-full rounded transition-all"
                            style={{
                                width: `${item.durability.percentage}%`,
                                backgroundColor:
                                    item.durability.percentage > 50
                                        ? '#22c55e'
                                        : item.durability.percentage > 20
                                          ? '#eab308'
                                          : '#ef4444',
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Lore */}
            {item.lore.length > 0 && (
                <div className="mt-2 space-y-0.5 border-t border-neutral-700 pt-2">
                    {item.lore.map((line, idx) => (
                        <div key={idx} className="text-xs italic text-neutral-400">
                            {line}
                        </div>
                    ))}
                </div>
            )}

            {/* Container Contents (Bundles, Shulker Boxes) */}
            {isContainer && (
                <div className="mt-2 border-t border-neutral-700 pt-2">
                    <div className="text-xs text-neutral-400 font-medium mb-1">
                        Contains {item.contents.length} item{item.contents.length !== 1 ? 's' : ''}:
                    </div>
                    <div className="space-y-0.5 max-h-40 overflow-y-auto">
                        {groupedContents.slice(0, 15).map((groupedItem, idx) => (
                            <div key={idx} className="flex items-center text-xs">
                                <span className={groupedItem.isEnchantedBook ? 'text-purple-400' : 'text-neutral-300'}>
                                    {groupedItem.name}
                                </span>
                                {groupedItem.count > 1 && (
                                    <span className="ml-1 text-neutral-500">x{groupedItem.count}</span>
                                )}
                            </div>
                        ))}
                        {groupedContents.length > 15 && (
                            <div className="text-xs text-neutral-500 italic">
                                ...and {groupedContents.length - 15} more types
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

interface InventorySlotProps {
    item: InventoryItem | null;
    slotType?: 'normal' | 'armor' | 'offhand';
    label?: string;
}

const InventorySlot = ({ item, slotType = 'normal', label }: InventorySlotProps) => {
    const [hovered, setHovered] = useState(false);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
    const [imgError, setImgError] = useState(false);
    const [fallbackLevel, setFallbackLevel] = useState(0);
    const primary = useStoreState(state => state.theme.data!.colors.primary);

    const handleMouseMove = (e: React.MouseEvent) => {
        setTooltipPos({ x: e.clientX, y: e.clientY });
    };

    const getItemImageUrl = (item: InventoryItem, level: number = 0) => {
        const [rawNamespace, rawName] = item.id.split(':');
        const namespace = (rawName ? rawNamespace! : 'minecraft').toLowerCase();
        const itemName = (rawName ? rawName : rawNamespace!).toLowerCase();

        const moddedBaseUrls: Record<string, string> = {
            create: 'https://mc.nerothe.com/img/1.20-mods-create',
            regions_unexplored: 'https://mc.nerothe.com/img/1.21-mods-regions-unexplored',
            biomesoplenty: 'https://mc.nerothe.com/img/1.21-mods-biomes-o-plenty',
            quark: 'https://mc.nerothe.com/img/1.20-mods-quark',
        };

        // Modded items: only try the modded nerothe source, then fail silently
        if (namespace !== 'minecraft') {
            const baseUrl = moddedBaseUrls[namespace];
            const url = baseUrl ? `${baseUrl}/${namespace}_${itemName}.png` : '';
            return url;
        }

        // Vanilla items: multiple fallback sources for textures
        const sources = [
            // Primary: mc.nerothe.com (has most items including spawn eggs)
            `https://mc.nerothe.com/img/1.21.11/minecraft_${itemName}.png`,
            // Fallback 1: mc.nerothe.com older patch version
            `https://mc.nerothe.com/img/1.21.8/minecraft_${itemName}.png`,
            // Fallback 2: minecraft-assets item textures
            `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21/assets/minecraft/textures/item/${itemName}.png`,
            // Fallback 3: Block textures (for blocks like stone, dirt, etc.)
            `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.21/assets/minecraft/textures/block/${itemName}.png`,
        ];

        return sources[Math.min(level, sources.length - 1)];
    };

    const slotClasses = {
        normal: 'w-10 h-10',
        armor: 'w-12 h-12',
        offhand: 'w-12 h-12',
    };

    return (
        <div className="relative">
            {label && <div className="mb-1 text-center text-xs text-neutral-500">{label}</div>}
            <div
                className={`${slotClasses[slotType]} rounded bg-neutral-700/50 border border-neutral-600 flex items-center justify-center relative cursor-pointer transition-all hover:border-neutral-500`}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onMouseMove={handleMouseMove}
                style={item && item.enchantments.length > 0 ? { boxShadow: `0 0 8px ${primary}40` } : {}}
            >
                {item && item.id !== 'minecraft:air' ? (
                    <>
                        {!imgError ? (
                            <img
                                key={`${item.id}-${fallbackLevel}`}
                                src={getItemImageUrl(item, fallbackLevel)}
                                alt={item.name}
                                className="w-8 h-8 object-contain pixelated"
                                onError={() => {
                                    const isModded = !item.id.toLowerCase().startsWith('minecraft:');

                                    // Modded items: only one source, fail silently
                                    if (isModded) {
                                        setImgError(true);
                                        return;
                                    }

                                    // Try next fallback source (0-3 = 4 sources)
                                    if (fallbackLevel < 3) {
                                        setFallbackLevel(fallbackLevel + 1);
                                    } else {
                                        setImgError(true);
                                    }
                                }}
                            />
                        ) : (
                            <div className="w-8 h-8 flex items-center justify-center text-xs text-neutral-400 text-center leading-tight">
                                {item.displayId.substring(0, 3)}
                            </div>
                        )}
                        {item.count > 1 && (
                            <span className="absolute bottom-0 right-0.5 text-xs font-bold text-white drop-shadow-lg">
                                {item.count}
                            </span>
                        )}
                        {item.durability && item.durability.percentage < 100 && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-neutral-800">
                                <div
                                    className="h-full"
                                    style={{
                                        width: `${item.durability.percentage}%`,
                                        backgroundColor:
                                            item.durability.percentage > 50
                                                ? '#22c55e'
                                                : item.durability.percentage > 20
                                                  ? '#eab308'
                                                  : '#ef4444',
                                    }}
                                />
                            </div>
                        )}
                    </>
                ) : (
                    <div className="w-full h-full" />
                )}
            </div>
            {hovered && item && item.id !== 'minecraft:air' && <ItemTooltip item={item} position={tooltipPos} />}
        </div>
    );
};

interface InventoryGridProps {
    items: InventoryItem[];
    rows?: number;
    cols?: number;
    startSlot?: number;
}

const InventoryGrid = ({ items, rows = 4, cols = 9, startSlot = 0 }: InventoryGridProps) => {
    const slots: (InventoryItem | null)[] = Array(rows * cols).fill(null);

    items.forEach(item => {
        const adjustedSlot = item.slot - startSlot;
        if (adjustedSlot >= 0 && adjustedSlot < slots.length) {
            slots[adjustedSlot] = item;
        }
    });

    return (
        <div className="inline-grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, 40px)` }}>
            {slots.map((item, idx) => (
                <InventorySlot key={idx} item={item} />
            ))}
        </div>
    );
};

interface ArmorDisplayProps {
    armor: PlayerArmor;
    offhand: InventoryItem | null;
}

const ArmorDisplay = ({ armor, offhand }: ArmorDisplayProps) => {
    return (
        <div className="flex flex-col items-center gap-1">
            <InventorySlot item={armor.helmet} slotType="armor" label="Helmet" />
            <InventorySlot item={armor.chestplate} slotType="armor" label="Chest" />
            <InventorySlot item={armor.leggings} slotType="armor" label="Legs" />
            <InventorySlot item={armor.boots} slotType="armor" label="Boots" />
            <div className="mt-2">
                <InventorySlot item={offhand} slotType="offhand" label="Offhand" />
            </div>
        </div>
    );
};

interface LocationDisplayProps {
    location: PlayerLocation;
}

const LocationDisplay = ({ location }: LocationDisplayProps) => {
    const getDimensionColor = (dim: string) => {
        if (dim.includes('nether')) return 'text-red-400';
        if (dim.includes('end')) return 'text-purple-400';
        return 'text-green-400';
    };

    return (
        <div className="rounded-lg bg-zinc-800 p-4">
            <h4 className="mb-3 flex items-center gap-2 font-semibold text-white">
                <FontAwesomeIcon icon={faLocationDot} className="text-blue-400" />
                Location
            </h4>
            <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                    <div className="text-neutral-500">X</div>
                    <div className="font-mono text-white">{location.x.toFixed(1)}</div>
                </div>
                <div>
                    <div className="text-neutral-500">Y</div>
                    <div className="font-mono text-white">{location.y.toFixed(1)}</div>
                </div>
                <div>
                    <div className="text-neutral-500">Z</div>
                    <div className="font-mono text-white">{location.z.toFixed(1)}</div>
                </div>
            </div>
            <div className="mt-3 pt-3 border-t border-neutral-700">
                <div className="text-neutral-500 text-xs mb-1">Dimension</div>
                <div className={`font-medium ${getDimensionColor(location.dimension)}`}>{location.world}</div>
            </div>
        </div>
    );
};

interface StatsDisplayProps {
    stats: PlayerStats;
}

const StatsDisplay = ({ stats }: StatsDisplayProps) => {
    const primary = useStoreState(state => state.theme.data!.colors.primary);

    return (
        <div className="rounded-lg bg-zinc-800 p-4">
            <h4 className="mb-3 flex items-center gap-2 font-semibold text-white">
                <FontAwesomeIcon icon={faGamepad} style={{ color: primary }} />
                Stats
            </h4>
            <div className="space-y-3">
                {/* Health */}
                <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                        <span className="flex items-center gap-1 text-red-400">
                            <FontAwesomeIcon icon={faHeart} /> Health
                        </span>
                        <span className="text-white">
                            {stats.health.toFixed(1)}/{stats.maxHealth}
                        </span>
                    </div>
                    <div className="h-2 rounded bg-neutral-700 overflow-hidden">
                        <div
                            className="h-full rounded bg-red-500 transition-all"
                            style={{ width: `${Math.min(100, (stats.health / stats.maxHealth) * 100)}%` }}
                        />
                    </div>
                </div>

                {/* Food */}
                <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                        <span className="flex items-center gap-1 text-amber-400">
                            <FontAwesomeIcon icon={faDrumstickBite} /> Food
                        </span>
                        <span className="text-white">{stats.food}/20</span>
                    </div>
                    <div className="h-2 rounded bg-neutral-700">
                        <div
                            className="h-full rounded bg-amber-500 transition-all"
                            style={{ width: `${(stats.food / 20) * 100}%` }}
                        />
                    </div>
                </div>

                {/* XP */}
                <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                        <span className="flex items-center gap-1 text-green-400">
                            <FontAwesomeIcon icon={faStar} /> XP Level
                        </span>
                        <span className="text-white">{stats.xpLevel}</span>
                    </div>
                    <div className="h-2 rounded bg-neutral-700">
                        <div
                            className="h-full rounded bg-green-500 transition-all"
                            style={{ width: `${stats.xpProgress}%` }}
                        />
                    </div>
                </div>

                {/* Gamemode */}
                <div className="pt-2 border-t border-neutral-700">
                    <div className="flex items-center justify-between text-sm">
                        <span className="text-neutral-400">Gamemode</span>
                        <span className="text-white">{stats.gamemode}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

interface InventoryViewerProps {
    visible: boolean;
    onDismissed: () => void;
    onBack?: () => void;
    serverUuid: string;
    playerName: string;
}

const InventoryViewer = ({ visible, onDismissed, onBack, serverUuid, playerName }: InventoryViewerProps) => {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<PlayerDataResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'inventory' | 'enderchest'>('inventory');
    const primary = useStoreState(state => state.theme.data!.colors.primary);

    useEffect(() => {
        if (visible && serverUuid && playerName) {
            setLoading(true);
            setError(null);
            getPlayerData(serverUuid, playerName)
                .then(response => {
                    if (response.success) {
                        setData(response);
                    } else {
                        setError(response.error || 'Failed to load player data');
                    }
                })
                .catch(err => {
                    setError(err.message || 'Failed to load player data');
                })
                .finally(() => setLoading(false));
        }
    }, [visible, serverUuid, playerName]);

    return (
        <Modal visible={visible} onDismissed={onDismissed} closeOnBackground>
            <div className="max-h-[85vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-white">{playerName}'s Data</h2>
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

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <FontAwesomeIcon icon={faSpinner} spin className="text-3xl text-neutral-500" />
                    </div>
                ) : error ? (
                    <div className="text-center py-8">
                        <p className="text-red-400">{error}</p>
                    </div>
                ) : data ? (
                    <div className="space-y-6">
                        {/* Location & Stats Row */}
                        {data.location && data.stats && (
                            <div className="grid md:grid-cols-2 gap-4">
                                <LocationDisplay location={data.location} />
                                <StatsDisplay stats={data.stats} />
                            </div>
                        )}

                        {/* Tabs */}
                        <div className="flex gap-2 border-b border-neutral-700 pb-2">
                            <button
                                onClick={() => setActiveTab('inventory')}
                                className={`px-4 py-2 rounded-t-lg transition-colors ${
                                    activeTab === 'inventory'
                                        ? 'bg-zinc-800 text-white'
                                        : 'text-neutral-400 hover:text-white'
                                }`}
                            >
                                <FontAwesomeIcon icon={faBox} className="mr-2" />
                                Inventory
                            </button>
                            <button
                                onClick={() => setActiveTab('enderchest')}
                                className={`px-4 py-2 rounded-t-lg transition-colors ${
                                    activeTab === 'enderchest'
                                        ? 'bg-zinc-800 text-white'
                                        : 'text-neutral-400 hover:text-white'
                                }`}
                            >
                                <FontAwesomeIcon icon={faBoxesStacked} className="mr-2" />
                                Ender Chest
                            </button>
                        </div>

                        {/* Content */}
                        {activeTab === 'inventory' ? (
                            <div className="rounded-lg bg-zinc-800 p-4">
                                <div className="flex gap-6">
                                    {/* Armor & Offhand */}
                                    {data.armor && (
                                        <div className="flex-shrink-0">
                                            <h4 className="mb-3 flex items-center gap-2 font-semibold text-white">
                                                <FontAwesomeIcon icon={faShield} style={{ color: primary }} />
                                                Armor
                                            </h4>
                                            <ArmorDisplay armor={data.armor} offhand={data.offhand || null} />
                                        </div>
                                    )}

                                    {/* Main Inventory */}
                                    <div className="flex-1">
                                        <h4 className="mb-3 flex items-center gap-2 font-semibold text-white">
                                            <FontAwesomeIcon icon={faBox} style={{ color: primary }} />
                                            Inventory
                                        </h4>

                                        {/* Hotbar (slots 0-8) */}
                                        <div className="mb-4">
                                            <div className="text-xs text-neutral-500 mb-1">Hotbar</div>
                                            <InventoryGrid
                                                items={data.inventory?.filter(i => i.slot >= 0 && i.slot < 9) || []}
                                                rows={1}
                                                cols={9}
                                                startSlot={0}
                                            />
                                        </div>

                                        {/* Main Inventory (slots 9-35) */}
                                        <div>
                                            <div className="text-xs text-neutral-500 mb-1">Main Inventory</div>
                                            <InventoryGrid
                                                items={data.inventory?.filter(i => i.slot >= 9 && i.slot < 36) || []}
                                                rows={3}
                                                cols={9}
                                                startSlot={9}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-lg bg-zinc-800 p-4">
                                <h4 className="mb-3 flex items-center gap-2 font-semibold text-white">
                                    <FontAwesomeIcon icon={faBoxesStacked} className="text-purple-400" />
                                    Ender Chest
                                </h4>
                                <InventoryGrid items={data.enderChest || []} rows={3} cols={9} startSlot={0} />
                            </div>
                        )}
                    </div>
                ) : null}
            </div>
        </Modal>
    );
};

export default InventoryViewer;
