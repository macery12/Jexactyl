<?php

namespace Everest\Models;

use Illuminate\Support\Str;
use Symfony\Component\Yaml\Yaml;
use Illuminate\Container\Container;
use Illuminate\Notifications\Notifiable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Contracts\Encryption\Encrypter;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;

/**
 * @property int $id
 * @property string $uuid
 * @property bool $public
 * @property string $name
 * @property string|null $description
 * @property int|null $database_host_id
 * @property string $scheme
 * @property string $fqdn
 * @property int $listen_port_http
 * @property int $listen_port_sftp
 * @property int $public_port_http
 * @property int $public_port_sftp
 * @property bool $behind_proxy
 * @property bool $maintenance_mode
 * @property int $memory
 * @property int $memory_overallocate
 * @property int $sum_memory
 * @property int $disk
 * @property int $disk_overallocate
 * @property int $sum_disk
 * @property int $upload_size
 * @property string $daemon_token_id
 * @property string $daemon_token
 * @property string $daemon_base
 * @property bool|null $deployable
 * @property bool|null $deployable_free
 * @property int $servers_count
 * @property string|null $price_multiplier_description
 * @property string $wings_type
 * @property string|null $wings_version
 * @property \Carbon\Carbon|null $wings_detected_at
 * @property \Carbon\Carbon $created_at
 * @property \Carbon\Carbon $updated_at
 * @property Allocation[]|Collection $allocations
 * @property DatabaseHost|null $databaseHost
 * @property Mount[]|Collection $mounts
 * @property int[]|\Illuminate\Support\Collection $ports
 * @property Server[]|Collection $servers
 */
class Node extends Model
{
    use Notifiable;

    /**
     * The resource name for this model when it is transformed into an
     * API representation using fractal.
     */
    public const RESOURCE_NAME = 'node';

    /**
     * The default location of server files on the Wings instance.
     */
    public const DEFAULT_DAEMON_BASE = '/var/lib/pterodactyl/volumes';

    public const DAEMON_TOKEN_ID_LENGTH = 16;
    public const DAEMON_TOKEN_LENGTH = 64;

    public const WINGS_TYPE_DEFAULT = 'default';
    public const WINGS_TYPE_RS = 'wings-rs';

    /**
     * The table associated with the model.
     */
    protected $table = 'nodes';

    /**
     * The attributes excluded from the model's JSON form.
     */
    protected $hidden = ['daemon_token_id', 'daemon_token'];

    /**
     * Cast values to correct type.
     */
    protected $casts = [
        'database_host_id' => 'integer',
        'listen_port_http' => 'integer',
        'listen_port_sftp' => 'integer',
        'public_port_http' => 'integer',
        'public_port_sftp' => 'integer',
        'memory' => 'integer',
        'disk' => 'integer',
        'behind_proxy' => 'boolean',
        'public' => 'boolean',
        'maintenance_mode' => 'boolean',
        'deployable' => 'boolean',
        'deployable_free' => 'boolean',
        'price_multiplier' => 'float',
        'price_multiplier_description' => 'string',
        'wings_type' => 'string',
        'wings_version' => 'string',
        'wings_detected_at' => 'datetime',
    ];

    /**
     * Fields that are mass assignable.
     */
    protected $fillable = [
        'public', 'name', 'database_host_id',
        'listen_port_http', 'listen_port_sftp', 'public_port_http', 'public_port_sftp',
        'fqdn', 'scheme', 'behind_proxy',
        'memory', 'memory_overallocate', 'disk',
        'disk_overallocate', 'upload_size', 'daemon_base',
        'description', 'maintenance_mode', 'deployable', 'deployable_free', 'price_multiplier', 'price_multiplier_description',
        'wings_type', 'wings_version', 'wings_detected_at',
    ];

    public static array $validationRules = [
        'name' => 'required|regex:/^([\w .-]{1,100})$/',
        'description' => 'string|nullable',
        'database_host_id' => 'sometimes|nullable|exists:database_hosts,id',
        'public' => 'boolean',
        'fqdn' => 'required|string',
        'listen_port_http' => 'required|numeric|between:1,65535',
        'listen_port_sftp' => 'required|numeric|between:1,65535',
        'public_port_http' => 'required|numeric|between:1,65535',
        'public_port_sftp' => 'required|numeric|between:1,65535',
        'scheme' => 'required',
        'behind_proxy' => 'boolean',
        'memory' => 'required|numeric|min:1',
        'memory_overallocate' => 'required|numeric|min:-1',
        'disk' => 'required|numeric|min:1',
        'disk_overallocate' => 'required|numeric|min:-1',
        'daemon_base' => 'sometimes|required|regex:/^([\/][\d\w.\-\/]+)$/',
        'maintenance_mode' => 'boolean',
        'upload_size' => 'int|between:1,1024',
        'deployable' => 'nullable|boolean',
        'deployable_free' => 'nullable|boolean',
        'price_multiplier_description' => 'nullable|string|max:500',
    ];

    /**
     * Default values for specific columns that are generally not changed on base installs.
     */
    protected $attributes = [
        'listen_port_http' => 8080,
        'listen_port_sftp' => 2022,
        'public_port_http' => 8080,
        'public_port_sftp' => 2022,
        'public' => true,
        'behind_proxy' => false,
        'memory_overallocate' => 0,
        'disk_overallocate' => 0,
        'daemon_base' => self::DEFAULT_DAEMON_BASE,
        'maintenance_mode' => false,
        'wings_type' => self::WINGS_TYPE_DEFAULT,
    ];

    public function getPriceMultiplierAttribute($value): float
    {
        return (float) ($value ?? 1.0);
    }

    /**
     * Determine if this node is running Wings-RS (Supercharged).
     */
    public function isSupercharged(): bool
    {
        return $this->wings_type === self::WINGS_TYPE_RS;
    }

    /**
     * Get the connection address to use when making calls to this node.
     */
    public function getConnectionAddress(): string
    {
        return sprintf('%s://%s:%s', $this->scheme, $this->fqdn, $this->public_port_http);
    }

    /**
     * Returns the configuration as an array.
     */
    public function getConfiguration(): array
    {
        return [
            'debug' => false,
            'uuid' => $this->uuid,
            'token_id' => $this->daemon_token_id,
            'token' => Container::getInstance()->make(Encrypter::class)->decrypt($this->daemon_token),
            'api' => [
                'host' => '0.0.0.0',
                'port' => $this->listen_port_http,
                'ssl' => [
                    'enabled' => (!$this->behind_proxy && $this->scheme === 'https'),
                    'cert' => '/etc/letsencrypt/live/' . Str::lower($this->fqdn) . '/fullchain.pem',
                    'key' => '/etc/letsencrypt/live/' . Str::lower($this->fqdn) . '/privkey.pem',
                ],
                'upload_limit' => $this->upload_size,
            ],
            'system' => [
                'data' => $this->daemon_base,
                'sftp' => [
                    'bind_port' => $this->listen_port_sftp,
                ],
            ],
            'allowed_mounts' => $this->mounts->pluck('source')->toArray(),
            'remote' => route('index'),
        ];
    }

    /**
     * Returns the configuration in Yaml format.
     */
    public function getYamlConfiguration(): string
    {
        return Yaml::dump($this->getConfiguration(), 4, 2, Yaml::DUMP_EMPTY_ARRAY_AS_SEQUENCE);
    }

    /**
     * Returns the configuration in JSON format.
     */
    public function getJsonConfiguration(bool $pretty = false): string
    {
        return json_encode($this->getConfiguration(), $pretty ? JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT : JSON_UNESCAPED_SLASHES);
    }

    /**
     * Helper function to return the decrypted key for a node.
     */
    public function getDecryptedKey(): string
    {
        return (string) Container::getInstance()->make(Encrypter::class)->decrypt(
            $this->daemon_token
        );
    }

    public function isUnderMaintenance(): bool
    {
        return $this->maintenance_mode;
    }

    /**
     * Gets the allocations associated with a node.
     */
    public function allocations(): HasMany
    {
        return $this->hasMany(Allocation::class);
    }

    /**
     * Returns the database host associated with a node.
     */
    public function databaseHost(): BelongsTo
    {
        return $this->belongsTo(DatabaseHost::class);
    }

    /**
     * Returns a HasManyThrough relationship for all the mounts associated with a node.
     */
    public function mounts(): HasManyThrough
    {
        return $this->hasManyThrough(Mount::class, MountNode::class, 'node_id', 'id', 'id', 'mount_id');
    }

    /**
     * Gets the servers associated with a node.
     */
    public function servers(): HasMany
    {
        return $this->hasMany(Server::class);
    }

    public function loadServerSums(): self
    {
        $this->loadSum('servers as sum_memory', 'memory');
        $this->loadSum('servers as sum_disk', 'disk');

        $this->loadCount([
            'allocations as total_allocations',
            'allocations as used_allocations' => function ($query) {
                $query->whereNotNull('server_id');
            },
        ]);

        return $this;
    }

    /**
     * Returns a boolean if the node is viable for an additional server to be placed on it.
     */
    public function isViable(int $memory = 0, int $disk = 0): bool
    {
        $this->loadServerSums();

        $memoryLimit = $this->memory * (1.0 + ($this->memory_overallocate / 100.0));
        $diskLimit = $this->disk * (1.0 + ($this->disk_overallocate / 100.0));

        return ($this->sum_memory + $memory) <= $memoryLimit && ($this->sum_disk + $disk) <= $diskLimit;
    }

    /**
     * Returns an array of memory, disk and allocations used compared to the total limit
     * as a percent rounded to 1.S.F.
     */
    public function getPercentUtilization(): array
    {
        $sums = $this->loadServerSums();
        $memoryUsed = $sums->sum_memory;
        $diskUsed = $sums->sum_disk;

        $memoryPercent = $this->memory > 0
            ? ($memoryUsed / $this->memory) * 100
            : 0;

        $diskPercent = $this->disk > 0
            ? ($diskUsed / $this->disk) * 100
            : 0;

        $allocationsPercent = $sums->total_allocations > 0
            ? ($sums->used_allocations / $sums->total_allocations) * 100
            : 0;

        return [
            'memory' => round($memoryPercent, 1),
            'disk' => round($diskPercent, 1),
            'allocations' => round($allocationsPercent, 1),
        ];
    }
}
