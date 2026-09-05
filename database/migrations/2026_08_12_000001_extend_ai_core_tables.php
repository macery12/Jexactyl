<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

/*
 * Extend the released AI schema to its final agent-ready shape.
 *
 * These changes stay separate from the agent-owned tables because they alter
 * tables in the released migration chain. Keeping each table to one schema
 * operation avoids the create-then-patch sequence used during development and
 * makes fresh installs build the final shape directly.
 */
return new class () extends Migration {
    public function up(): void
    {
        $this->relaxConversationServer();

        Schema::table('ai_conversations', function (Blueprint $table): void {
            $table->string('scope', 16)->default('server')->after('server_uuid');
            $table->json('redactions')->nullable()->after('title');
            $table->json('assist')->nullable()->after('redactions');
            $table->index(['user_id', 'scope'], 'ai_conversations_user_id_scope_index');
        });

        Schema::table('ai_messages', function (Blueprint $table): void {
            $table->json('tool_calls')->nullable()->after('content');
            $table->string('tool_call_id', 128)->nullable()->after('tool_calls');
            $table->string('tool_name', 64)->nullable()->after('tool_call_id');
            $table->unsignedSmallInteger('step')->nullable()->after('tool_name');
            $table->timestamp('created_at', 3)->useCurrent()->change();
        });
        $this->setMessageRoles(['user', 'assistant', 'system', 'tool']);

        $this->setUsageStatuses(['success', 'error', 'suspended', 'running', 'cancelled']);
        Schema::table('ai_usage_logs', function (Blueprint $table): void {
            $table->uuid('turn_id')->nullable()->after('conversation_id');
            $table->unsignedSmallInteger('step')->nullable()->after('turn_id');
            $table->unsignedSmallInteger('tool_calls_count')->default(0)->after('step');
            $table->timestamp('heartbeat_at')->nullable()->after('error_message');
            $table->timestamp('deadline_at')->nullable()->after('heartbeat_at');
            $table->timestamp('cancel_requested_at')->nullable()->after('deadline_at');

            $table->unique('turn_id', 'ai_usage_logs_turn_unique');
            $table->index(['user_id', 'created_at'], 'ai_usage_logs_user_created_index');
            $table->index(['user_id', 'status', 'id'], 'ai_usage_logs_user_status_id_index');
        });

        Schema::table('tickets', function (Blueprint $table): void {
            $table->unsignedInteger('server_id')->nullable()->after('user_id');
            $table->foreign('server_id')->references('id')->on('servers')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('tickets', function (Blueprint $table): void {
            $table->dropForeign(['server_id']);
            $table->dropColumn('server_id');
        });

        DB::table('ai_usage_logs')
            ->whereIn('status', ['suspended', 'running', 'cancelled'])
            ->update(['status' => 'error']);

        Schema::table('ai_usage_logs', function (Blueprint $table): void {
            $table->dropUnique('ai_usage_logs_turn_unique');
            $table->dropIndex('ai_usage_logs_user_created_index');
            $table->dropIndex('ai_usage_logs_user_status_id_index');
            $table->dropColumn([
                'turn_id',
                'step',
                'tool_calls_count',
                'heartbeat_at',
                'deadline_at',
                'cancel_requested_at',
            ]);
        });
        $this->setUsageStatuses(['success', 'error']);

        DB::table('ai_messages')
            ->whereNotIn('role', ['user', 'assistant'])
            ->update(['role' => 'assistant']);
        $this->setMessageRoles(['user', 'assistant']);
        Schema::table('ai_messages', function (Blueprint $table): void {
            $table->dropColumn(['tool_calls', 'tool_call_id', 'tool_name', 'step']);
            $table->timestamp('created_at')->useCurrent()->change();
        });

        // Only admin conversations can legitimately have no server. They have
        // no representation in the released schema, so rollback removes them
        // before restoring the NOT NULL constraint.
        DB::table('ai_conversations')->whereNull('server_uuid')->delete();

        Schema::table('ai_conversations', function (Blueprint $table): void {
            $table->dropIndex('ai_conversations_user_id_scope_index');
            $table->dropColumn(['scope', 'redactions', 'assist']);
        });
        $this->requireConversationServer();
    }

    /** @param list<string> $roles */
    private function setMessageRoles(array $roles): void
    {
        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'mysql' || $driver === 'mariadb') {
            $quoted = implode(',', array_map(fn (string $role) => "'{$role}'", $roles));
            DB::statement("ALTER TABLE `ai_messages` MODIFY `role` ENUM({$quoted}) NOT NULL");

            return;
        }

        Schema::table('ai_messages', function (Blueprint $table): void {
            $table->string('role', 16)->default('user')->change();
        });
    }

    /** @param list<string> $statuses */
    private function setUsageStatuses(array $statuses): void
    {
        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'mysql' || $driver === 'mariadb') {
            $quoted = implode(',', array_map(fn (string $status) => "'{$status}'", $statuses));
            DB::statement("ALTER TABLE `ai_usage_logs` MODIFY `status` ENUM({$quoted}) NOT NULL DEFAULT 'success'");

            return;
        }

        Schema::table('ai_usage_logs', function (Blueprint $table): void {
            $table->string('status', 16)->default('success')->change();
        });
    }

    private function relaxConversationServer(): void
    {
        $this->changeConversationServer(true);
    }

    private function requireConversationServer(): void
    {
        $this->changeConversationServer(false);
    }

    private function changeConversationServer(bool $nullable): void
    {
        $driver = Schema::getConnection()->getDriverName();
        $mysql = $driver === 'mysql' || $driver === 'mariadb';

        if ($mysql) {
            Schema::table('ai_conversations', function (Blueprint $table): void {
                $table->dropForeign(['server_uuid']);
            });
        }

        Schema::table('ai_conversations', function (Blueprint $table) use ($nullable): void {
            $column = $table->char('server_uuid', 36);

            if ($nullable) {
                $column->nullable();
            }

            $column->change();
        });

        if ($mysql) {
            Schema::table('ai_conversations', function (Blueprint $table): void {
                $table->foreign('server_uuid')->references('uuid')->on('servers')->cascadeOnDelete();
            });
        }
    }
};
