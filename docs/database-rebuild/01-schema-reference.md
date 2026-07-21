# Final Schema Reference

> Source of truth: the schema produced by running **all 325 historical migrations** in
> order against a fresh MariaDB 10.11 database (utf8mb4), dumped 2026-07-13.
> Amended 2026-07-20 for the post-audit migration `2026_07_14_000001`
> (`ai_usage_logs.cached`). This document describes what a fresh install produces
> **today** and is the target schema for the rebuilt migration set. `migrations`
> (framework bookkeeping) excluded.

**82 tables.** The rebuild produces **80**: `subscriptions` and
`subscription_items` are omitted per D2 resolution (2026-07-20); their shapes
below are kept for reference.

## Table index

- [activity_logs](#activity_logs)
- [activity_log_subjects](#activity_log_subjects)
- [admin_roles](#admin_roles)
- [ai_conversations](#ai_conversations)
- [ai_messages](#ai_messages)
- [ai_usage_logs](#ai_usage_logs)
- [alerts](#alerts)
- [alert_user](#alert_user)
- [allocations](#allocations)
- [api_keys](#api_keys)
- [api_logs](#api_logs)
- [audit_logs](#audit_logs)
- [backups](#backups)
- [billing_cycles](#billing_cycles)
- [billing_exceptions](#billing_exceptions)
- [categories](#categories)
- [coupons](#coupons)
- [coupon_usage](#coupon_usage)
- [custom_domains](#custom_domains)
- [custom_domain_api_keys](#custom_domain_api_keys)
- [custom_domain_dns_logs](#custom_domain_dns_logs)
- [custom_links](#custom_links)
- [databases](#databases)
- [database_hosts](#database_hosts)
- [deferred_emails](#deferred_emails)
- [download_queue](#download_queue)
- [eggs](#eggs)
- [egg_mount](#egg_mount)
- [egg_variables](#egg_variables)
- [email_deliveries](#email_deliveries)
- [email_delivery_attempts](#email_delivery_attempts)
- [email_notification_settings](#email_notification_settings)
- [email_quotas](#email_quotas)
- [extension_configs](#extension_configs)
- [extension_file_snapshots](#extension_file_snapshots)
- [extension_packages](#extension_packages)
- [extension_package_files](#extension_package_files)
- [extension_repositories](#extension_repositories)
- [failed_jobs](#failed_jobs)
- [invoices](#invoices)
- [invoice_settings](#invoice_settings)
- [jguard_delay](#jguard_delay)
- [jobs](#jobs)
- [marketplace_install_logs](#marketplace_install_logs)
- [mounts](#mounts)
- [mount_node](#mount_node)
- [mount_server](#mount_server)
- [nests](#nests)
- [nodes](#nodes)
- [notifications](#notifications)
- [orders](#orders)
- [password_resets](#password_resets)
- [password_reset_tokens](#password_reset_tokens)
- [payment_transactions](#payment_transactions)
- [plugin_provider_rules](#plugin_provider_rules)
- [products](#products)
- [recovery_tokens](#recovery_tokens)
- [resend_quotas](#resend_quotas)
- [schedules](#schedules)
- [servers](#servers)
- [server_custom_domains](#server_custom_domains)
- [server_groups](#server_groups)
- [server_group_members](#server_group_members)
- [server_presets](#server_presets)
- [server_transfers](#server_transfers)
- [server_variables](#server_variables)
- [sessions](#sessions)
- [settings](#settings)
- [subscriptions](#subscriptions)
- [subscription_items](#subscription_items)
- [subusers](#subusers)
- [tasks](#tasks)
- [tasks_log](#tasks_log)
- [theme](#theme)
- [theme_presets](#theme_presets)
- [tickets](#tickets)
- [ticket_messages](#ticket_messages)
- [users](#users)
- [user_billing_profiles](#user_billing_profiles)
- [user_sessions](#user_sessions)
- [user_ssh_keys](#user_ssh_keys)
- [webhook_events](#webhook_events)

## activity_logs

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| batch | `char(36)` | yes | `NULL` |  |
| event | `varchar(191)` | no | — |  |
| ip | `varchar(191)` | no | — |  |
| description | `text` | yes | `NULL` |  |
| actor_type | `varchar(191)` | yes | `NULL` |  |
| actor_id | `bigint(20) unsigned` | yes | `NULL` |  |
| server_id | `bigint(20) unsigned` | yes | `NULL` |  |
| api_key_id | `int(10) unsigned` | yes | `NULL` |  |
| properties | `longtext` | no | — |  |
| timestamp | `timestamp` | no | `current_timestamp()` |  |
| is_admin | `tinyint(1)` | no | `0` |  |
| scope | `varchar(191)` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `activity_logs_actor_type_actor_id_index` (actor_type, actor_id)
- INDEX `activity_logs_event_index` (event)
- INDEX `activity_logs_scope_index` (scope)
- INDEX `activity_logs_server_id_index` (server_id)
- INDEX `activity_logs_timestamp_index` (timestamp)

## activity_log_subjects

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| activity_log_id | `bigint(20) unsigned` | no | — |  |
| subject_type | `varchar(191)` | no | — |  |
| subject_id | `bigint(20) unsigned` | no | — |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `activity_log_subjects_activity_log_id_foreign` (activity_log_id)
- INDEX `activity_log_subjects_subject_type_subject_id_index` (subject_type, subject_id)

**Foreign keys**

- `activity_log_id` → `activity_logs.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `activity_log_subjects_activity_log_id_foreign`

## admin_roles

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| name | `varchar(64)` | no | — |  |
| description | `varchar(255)` | yes | `NULL` |  |
| sort_id | `int(11)` | no | — |  |
| permissions | `longtext` | yes | `NULL` |  |
| color | `varchar(191)` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `admin_roles_id_unique` (id)

## ai_conversations

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| user_id | `int(10) unsigned` | no | — |  |
| server_uuid | `char(36)` | no | — |  |
| title | `varchar(255)` | no | `'New conversation'` |  |
| is_saved | `tinyint(1)` | no | `0` |  |
| expires_at | `timestamp` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `ai_conversations_expires_at_index` (expires_at)
- INDEX `ai_conversations_server_uuid_foreign` (server_uuid)
- INDEX `ai_conversations_user_id_server_uuid_index` (user_id, server_uuid)

**Foreign keys**

- `server_uuid` → `servers.uuid` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `ai_conversations_server_uuid_foreign`
- `user_id` → `users.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `ai_conversations_user_id_foreign`

## ai_messages

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| conversation_id | `bigint(20) unsigned` | no | — |  |
| role | `enum('user','assistant')` | no | — |  |
| content | `text` | no | — |  |
| created_at | `timestamp` | no | `current_timestamp()` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `ai_messages_conversation_id_index` (conversation_id)

**Foreign keys**

- `conversation_id` → `ai_conversations.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `ai_messages_conversation_id_foreign`

## ai_usage_logs

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| user_id | `int(10) unsigned` | yes | `NULL` |  |
| server_uuid | `char(36)` | yes | `NULL` |  |
| conversation_id | `bigint(20) unsigned` | yes | `NULL` |  |
| model | `varchar(100)` | no | — |  |
| source | `varchar(20)` | no | `'client'` |  |
| prompt_tokens | `int(10) unsigned` | yes | `NULL` |  |
| completion_tokens | `int(10) unsigned` | yes | `NULL` |  |
| total_tokens | `int(10) unsigned` | yes | `NULL` |  |
| latency_ms | `int(10) unsigned` | yes | `NULL` |  |
| status | `enum('success','error')` | no | `'success'` |  |
| cached | `tinyint(1)` | no | `0` | *added post-audit by `2026_07_14_000001`* |
| error_message | `text` | yes | `NULL` |  |
| created_at | `timestamp` | no | `current_timestamp()` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `ai_usage_logs_conversation_id_foreign` (conversation_id)
- INDEX `ai_usage_logs_created_at_index` (created_at)
- INDEX `ai_usage_logs_server_uuid_index` (server_uuid)
- INDEX `ai_usage_logs_user_id_index` (user_id)

**Foreign keys**

- `conversation_id` → `ai_conversations.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `ai_usage_logs_conversation_id_foreign`
- `server_uuid` → `servers.uuid` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `ai_usage_logs_server_uuid_foreign`
- `user_id` → `users.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `ai_usage_logs_user_id_foreign`

## alerts

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| title | `varchar(191)` | yes | `NULL` |  |
| content | `text` | no | — |  |
| type | `varchar(191)` | no | `'info'` |  |
| position | `varchar(255)` | yes | `'top-center'` |  |
| scope | `varchar(191)` | no | `'global'` |  |
| user_targeting | `enum('all','specific')` | no | `'all'` |  |
| enabled | `tinyint(1)` | no | `1` |  |
| dismissible | `tinyint(1)` | no | `0` |  |
| show_button | `tinyint(1)` | no | `0` |  |
| button_text | `varchar(191)` | yes | `NULL` |  |
| button_position | `varchar(191)` | no | `'bottom-right'` |  |
| link | `varchar(191)` | yes | `NULL` |  |
| link_text | `varchar(191)` | yes | `NULL` |  |
| priority | `int(11)` | no | `0` |  |
| start_at | `timestamp` | yes | `NULL` |  |
| end_at | `timestamp` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)

## alert_user

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| alert_id | `bigint(20) unsigned` | no | — |  |
| user_id | `int(10) unsigned` | no | — |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `alert_user_alert_id_user_id_unique` (alert_id, user_id)
- INDEX `alert_user_user_id_foreign` (user_id)

**Foreign keys**

- `alert_id` → `alerts.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `alert_user_alert_id_foreign`
- `user_id` → `users.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `alert_user_user_id_foreign`

## allocations

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| node_id | `int(10) unsigned` | no | — |  |
| ip | `varchar(191)` | no | — |  |
| ip_alias | `text` | yes | `NULL` |  |
| port | `mediumint(8) unsigned` | no | — |  |
| server_id | `int(10) unsigned` | yes | `NULL` |  |
| notes | `varchar(191)` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `allocations_node_id_ip_port_unique` (node_id, ip, port)
- INDEX `allocations_server_id_foreign` (server_id)

**Foreign keys**

- `node_id` → `nodes.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `allocations_node_id_foreign`
- `server_id` → `servers.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `allocations_server_id_foreign`

## api_keys

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| user_id | `int(10) unsigned` | no | — |  |
| key_type | `tinyint(3) unsigned` | no | `0` |  |
| identifier | `char(16)` | yes | `NULL` |  |
| token | `text` | no | — |  |
| allowed_ips | `text` | yes | `NULL` |  |
| memo | `text` | yes | `NULL` |  |
| last_used_at | `timestamp` | yes | `NULL` |  |
| expires_at | `timestamp` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |
| r_servers | `tinyint(3) unsigned` | no | `0` |  |
| r_nodes | `tinyint(3) unsigned` | no | `0` |  |
| r_allocations | `tinyint(3) unsigned` | no | `0` |  |
| r_users | `tinyint(3) unsigned` | no | `0` |  |
| r_locations | `tinyint(3) unsigned` | no | `0` |  |
| r_nests | `tinyint(3) unsigned` | no | `0` |  |
| r_eggs | `tinyint(3) unsigned` | no | `0` |  |
| r_database_hosts | `tinyint(3) unsigned` | no | `0` |  |
| r_server_databases | `tinyint(3) unsigned` | no | `0` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `api_keys_identifier_unique` (identifier)
- INDEX `api_keys_user_id_foreign` (user_id)

**Foreign keys**

- `user_id` → `users.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `api_keys_user_id_foreign`

## api_logs

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| authorized | `tinyint(1)` | no | — |  |
| error | `text` | yes | `NULL` |  |
| key | `char(16)` | yes | `NULL` |  |
| method | `char(6)` | no | — |  |
| route | `text` | no | — |  |
| content | `text` | yes | `NULL` |  |
| user_agent | `text` | no | — |  |
| request_ip | `varchar(45)` | no | — |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)

## audit_logs

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| uuid | `char(36)` | no | — |  |
| is_system | `tinyint(1)` | no | `0` |  |
| user_id | `int(10) unsigned` | yes | `NULL` |  |
| server_id | `int(10) unsigned` | yes | `NULL` |  |
| action | `varchar(191)` | no | — |  |
| subaction | `varchar(191)` | yes | `NULL` |  |
| device | `longtext` | no | — |  |
| metadata | `longtext` | no | — |  |
| created_at | `timestamp` | no | — |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `audit_logs_action_server_id_index` (action, server_id)
- INDEX `audit_logs_created_at_index` (created_at)
- INDEX `audit_logs_server_id_foreign` (server_id)
- INDEX `audit_logs_user_id_foreign` (user_id)

**Foreign keys**

- `server_id` → `servers.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `audit_logs_server_id_foreign`
- `user_id` → `users.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `audit_logs_user_id_foreign`

## backups

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| server_id | `int(10) unsigned` | no | — |  |
| uuid | `char(36)` | no | — |  |
| is_successful | `tinyint(1)` | no | `0` |  |
| upload_id | `text` | yes | `NULL` |  |
| is_locked | `tinyint(3) unsigned` | no | `0` |  |
| name | `varchar(191)` | no | — |  |
| ignored_files | `text` | yes | `NULL` |  |
| disk | `varchar(191)` | no | — |  |
| checksum | `varchar(191)` | yes | `NULL` |  |
| bytes | `bigint(20) unsigned` | no | `0` |  |
| completed_at | `timestamp` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |
| deleted_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `backups_server_id_foreign` (server_id)
- UNIQUE `backups_uuid_unique` (uuid)

**Foreign keys**

- `server_id` → `servers.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `backups_server_id_foreign`

## billing_cycles

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| product_id | `bigint(20) unsigned` | no | — |  |
| days | `int(11)` | no | — |  |
| is_enabled | `tinyint(1)` | no | `1` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `billing_cycles_product_id_days_unique` (product_id, days)

**Foreign keys**

- `product_id` → `products.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `billing_cycles_product_id_foreign`

## billing_exceptions

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| uuid | `char(36)` | no | — |  |
| order_id | `int(10) unsigned` | yes | `NULL` |  |
| title | `text` | no | — |  |
| description | `text` | no | — |  |
| exception_type | `varchar(191)` | no | — |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)

## categories

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| uuid | `char(36)` | no | — |  |
| name | `varchar(191)` | no | — |  |
| icon | `varchar(191)` | yes | `NULL` |  |
| description | `varchar(191)` | yes | `NULL` |  |
| visible | `varchar(191)` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |
| egg_id | `int(10) unsigned` | no | — |  |
| allowed_eggs | `longtext` | yes | `NULL` |  |
| allow_egg_changes | `tinyint(1)` | no | `1` |  |
| allow_plan_changes | `tinyint(1)` | no | `1` |  |
| nest_id | `int(10) unsigned` | no | — |  |

**Indexes**

- PRIMARY `PRIMARY` (id)

## coupons

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| code | `varchar(191)` | no | — |  |
| type | `enum('percentage','fixed')` | no | — |  |
| value | `decimal(10,2)` | no | — |  |
| max_uses | `int(11)` | yes | `NULL` |  |
| max_uses_per_user | `int(11)` | yes | `NULL` |  |
| min_order_total | `decimal(10,2)` | yes | `NULL` |  |
| expires_at | `datetime` | yes | `NULL` |  |
| is_active | `tinyint(1)` | no | `1` |  |
| allowed_for | `enum('both','purchases','renewals')` | no | `'both'` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `coupons_code_unique` (code)

## coupon_usage

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| coupon_id | `bigint(20) unsigned` | no | — |  |
| user_id | `int(10) unsigned` | no | — |  |
| order_id | `bigint(20) unsigned` | no | — |  |
| used_at | `datetime` | no | — |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `coupon_usage_coupon_id_foreign` (coupon_id)
- INDEX `coupon_usage_order_id_foreign` (order_id)
- INDEX `coupon_usage_user_id_foreign` (user_id)

**Foreign keys**

- `coupon_id` → `coupons.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `coupon_usage_coupon_id_foreign`
- `order_id` → `orders.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `coupon_usage_order_id_foreign`
- `user_id` → `users.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `coupon_usage_user_id_foreign`

## custom_domains

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| domain | `varchar(191)` | no | — |  |
| cloudflare_zone_id | `varchar(191)` | yes | `NULL` |  |
| api_key_id | `bigint(20) unsigned` | yes | `NULL` |  |
| allowed_nest_ids | `longtext` | yes | `NULL` |  |
| allowed_egg_ids | `longtext` | yes | `NULL` |  |
| service_tag | `varchar(191)` | yes | `NULL` |  |
| egg_service_tags | `longtext` | yes | `NULL` |  |
| wildcard_enabled | `tinyint(1)` | no | `0` |  |
| enabled | `tinyint(1)` | no | `1` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `custom_domains_api_key_id_foreign` (api_key_id)
- UNIQUE `custom_domains_domain_unique` (domain)

**Foreign keys**

- `api_key_id` → `custom_domain_api_keys.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `custom_domains_api_key_id_foreign`

## custom_domain_api_keys

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| name | `varchar(191)` | no | — |  |
| token | `text` | no | — |  |
| enabled | `tinyint(1)` | no | `1` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `custom_domain_api_keys_name_unique` (name)

## custom_domain_dns_logs

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| server_id | `int(10) unsigned` | yes | `NULL` |  |
| server_custom_domain_id | `bigint(20) unsigned` | yes | `NULL` |  |
| action | `enum('create','update','delete','sync','ssl')` | no | — |  |
| status | `enum('success','failed')` | no | — |  |
| payload | `longtext` | yes | `NULL` |  |
| message | `text` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `custom_domain_dns_logs_server_custom_domain_id_foreign` (server_custom_domain_id)
- INDEX `custom_domain_dns_logs_server_id_created_at_index` (server_id, created_at)

**Foreign keys**

- `server_custom_domain_id` → `server_custom_domains.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `custom_domain_dns_logs_server_custom_domain_id_foreign`
- `server_id` → `servers.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `custom_domain_dns_logs_server_id_foreign`

## custom_links

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| url | `text` | no | — |  |
| name | `varchar(191)` | no | — |  |
| visible | `tinyint(1)` | no | — |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)

## databases

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| server_id | `int(10) unsigned` | no | — |  |
| database_host_id | `int(10) unsigned` | no | — |  |
| database | `varchar(191)` | no | — |  |
| username | `varchar(191)` | no | — |  |
| remote | `varchar(191)` | no | `'%'` |  |
| password | `text` | no | — |  |
| max_connections | `int(11)` | yes | `0` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `databases_database_host_id_server_id_database_unique` (database_host_id, server_id, database)
- UNIQUE `databases_database_host_id_username_unique` (database_host_id, username)
- INDEX `databases_server_id_foreign` (server_id)

**Foreign keys**

- `database_host_id` → `database_hosts.id` (ON DELETE RESTRICT, ON UPDATE RESTRICT) — `databases_database_host_id_foreign`
- `server_id` → `servers.id` (ON DELETE RESTRICT, ON UPDATE RESTRICT) — `databases_server_id_foreign`

## database_hosts

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| name | `varchar(191)` | no | — |  |
| host | `varchar(191)` | no | — |  |
| port | `int(10) unsigned` | no | — |  |
| username | `varchar(191)` | no | — |  |
| password | `text` | no | — |  |
| max_databases | `int(10) unsigned` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)

## deferred_emails

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| user_id | `bigint(20) unsigned` | no | — |  |
| template_key | `varchar(191)` | no | — |  |
| recipient | `varchar(191)` | no | — |  |
| data | `longtext` | no | — |  |
| correlation_id | `varchar(191)` | yes | `NULL` |  |
| reason | `varchar(191)` | no | — |  |
| scheduled_at | `timestamp` | no | — |  |
| sent_at | `timestamp` | yes | `NULL` |  |
| attempts | `int(11)` | no | `0` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `deferred_emails_scheduled_at_index` (scheduled_at)
- INDEX `deferred_emails_sent_at_index` (sent_at)
- INDEX `deferred_emails_user_id_index` (user_id)
- INDEX `deferred_emails_user_id_scheduled_at_index` (user_id, scheduled_at)

## download_queue

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| uuid | `char(36)` | no | — |  |
| server_id | `int(10) unsigned` | no | — |  |
| user_id | `int(10) unsigned` | yes | `NULL` |  |
| parent_id | `bigint(20) unsigned` | yes | `NULL` |  |
| provider | `varchar(64)` | no | — |  |
| source | `varchar(32)` | no | — |  |
| project_id | `varchar(128)` | no | — |  |
| file_id | `varchar(128)` | no | — |  |
| download_url | `varchar(2048)` | yes | `NULL` |  |
| install_path | `varchar(512)` | yes | `NULL` |  |
| file_hash_sha512 | `varchar(128)` | yes | `NULL` |  |
| hash_algo | `varchar(16)` | no | `'sha512'` |  |
| total_children | `int(10) unsigned` | yes | `NULL` |  |
| completed_children | `int(10) unsigned` | no | `0` |  |
| failed_children | `int(10) unsigned` | no | `0` |  |
| file_name | `varchar(255)` | yes | `NULL` |  |
| error_message | `text` | yes | `NULL` |  |
| install_log | `text` | yes | `NULL` |  |
| phase | `varchar(64)` | yes | `NULL` |  |
| status | `varchar(16)` | no | `'pending'` |  |
| started_at | `timestamp` | yes | `NULL` |  |
| completed_at | `timestamp` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `download_queue_parent_id_foreign` (parent_id)
- INDEX `download_queue_server_id_created_at_index` (server_id, created_at)
- INDEX `download_queue_server_id_status_index` (server_id, status)
- INDEX `download_queue_user_id_foreign` (user_id)
- UNIQUE `download_queue_uuid_unique` (uuid)

**Foreign keys**

- `parent_id` → `download_queue.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `download_queue_parent_id_foreign`
- `server_id` → `servers.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `download_queue_server_id_foreign`
- `user_id` → `users.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `download_queue_user_id_foreign`

## eggs

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| uuid | `char(36)` | no | — |  |
| nest_id | `int(10) unsigned` | no | — |  |
| author | `varchar(191)` | no | — |  |
| name | `varchar(191)` | no | — |  |
| description | `text` | yes | `NULL` |  |
| features | `longtext` | yes | `NULL` |  |
| docker_images | `longtext` | yes | `NULL` |  |
| file_denylist | `longtext` | yes | `NULL` |  |
| update_url | `text` | yes | `NULL` |  |
| config_files | `text` | yes | `NULL` |  |
| config_startup | `text` | yes | `NULL` |  |
| config_stop | `varchar(191)` | yes | `NULL` |  |
| config_from | `int(10) unsigned` | yes | `NULL` |  |
| startup | `text` | yes | `NULL` |  |
| script_container | `varchar(191)` | no | `'ghcr.io/pterodactyl/installers:alpine'` |  |
| copy_script_from | `int(10) unsigned` | yes | `NULL` |  |
| script_entry | `varchar(191)` | no | `'/bin/ash'` |  |
| script_is_privileged | `tinyint(1)` | no | `1` |  |
| script_install | `text` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |
| force_outgoing_ip | `tinyint(1)` | no | `0` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `eggs_config_from_foreign` (config_from)
- INDEX `eggs_copy_script_from_foreign` (copy_script_from)
- INDEX `service_options_nest_id_foreign` (nest_id)
- UNIQUE `service_options_uuid_unique` (uuid)

**Foreign keys**

- `config_from` → `eggs.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `eggs_config_from_foreign`
- `copy_script_from` → `eggs.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `eggs_copy_script_from_foreign`
- `nest_id` → `nests.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `service_options_nest_id_foreign`

## egg_mount

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| egg_id | `int(10) unsigned` | no | — |  |
| mount_id | `int(10) unsigned` | no | — |  |

**Indexes**

- UNIQUE `egg_mount_egg_id_mount_id_unique` (egg_id, mount_id)
- INDEX `egg_mount_mount_id_foreign` (mount_id)

**Foreign keys**

- `egg_id` → `eggs.id` (ON DELETE CASCADE, ON UPDATE CASCADE) — `egg_mount_egg_id_foreign`
- `mount_id` → `mounts.id` (ON DELETE CASCADE, ON UPDATE CASCADE) — `egg_mount_mount_id_foreign`

## egg_variables

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| egg_id | `int(10) unsigned` | no | — |  |
| name | `varchar(191)` | no | — |  |
| description | `text` | no | — |  |
| env_variable | `varchar(191)` | no | — |  |
| default_value | `text` | no | — |  |
| user_viewable | `tinyint(3) unsigned` | no | — |  |
| user_editable | `tinyint(3) unsigned` | no | — |  |
| rules | `text` | no | — |  |
| field_type | `varchar(191)` | no | `'text'` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `egg_variables_egg_id_env_variable_index` (egg_id, env_variable)

**Foreign keys**

- `egg_id` → `eggs.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `service_variables_egg_id_foreign`

## email_deliveries

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| tenant_id | `bigint(20) unsigned` | yes | `NULL` |  |
| correlation_id | `char(36)` | yes | `NULL` |  |
| template_key | `varchar(191)` | yes | `NULL` |  |
| recipient | `varchar(191)` | no | — |  |
| recipient_email | `varchar(191)` | yes | `NULL` |  |
| user_id | `int(10) unsigned` | yes | `NULL` |  |
| subject | `varchar(191)` | no | — |  |
| status | `varchar(191)` | no | `'queued'` |  |
| provider | `varchar(191)` | yes | `'resend'` |  |
| provider_message_id | `varchar(191)` | yes | `NULL` |  |
| metadata | `longtext` | yes | `NULL` |  |
| attempts | `int(10) unsigned` | no | `0` |  |
| last_attempt_at | `timestamp` | yes | `NULL` |  |
| sent_at | `timestamp` | yes | `NULL` |  |
| last_message_id | `varchar(191)` | yes | `NULL` |  |
| last_status_code | `int(10) unsigned` | yes | `NULL` |  |
| last_error | `text` | yes | `NULL` |  |
| tags | `longtext` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `email_deliveries_correlation_id_unique` (correlation_id)
- INDEX `email_deliveries_recipient_email_index` (recipient_email)
- INDEX `email_deliveries_recipient_index` (recipient)
- INDEX `email_deliveries_status_created_at_index` (status, created_at)
- INDEX `email_deliveries_template_key_created_at_index` (template_key, created_at)
- INDEX `email_deliveries_tenant_id_index` (tenant_id)
- INDEX `email_deliveries_user_id_created_at_index` (user_id, created_at)

**Foreign keys**

- `user_id` → `users.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `email_deliveries_user_id_foreign`

## email_delivery_attempts

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| delivery_id | `bigint(20) unsigned` | no | — |  |
| attempt_number | `int(10) unsigned` | no | — |  |
| provider | `varchar(191)` | yes | `NULL` |  |
| status | `varchar(191)` | no | — |  |
| response_code | `int(10) unsigned` | yes | `NULL` |  |
| status_code | `int(10) unsigned` | yes | `NULL` |  |
| provider_message_id | `varchar(191)` | yes | `NULL` |  |
| error_message | `text` | yes | `NULL` |  |
| error | `text` | yes | `NULL` |  |
| raw_response | `longtext` | yes | `NULL` |  |
| response_payload | `text` | yes | `NULL` |  |
| request_payload | `longtext` | yes | `NULL` |  |
| started_at | `timestamp` | yes | `NULL` |  |
| finished_at | `timestamp` | yes | `NULL` |  |
| duration_ms | `int(10) unsigned` | yes | `NULL` |  |
| success | `tinyint(1)` | no | `0` |  |
| exception_class | `varchar(191)` | yes | `NULL` |  |
| stacktrace | `longtext` | yes | `NULL` |  |
| created_at | `timestamp` | no | `current_timestamp()` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `email_delivery_attempts_delivery_id_attempt_number_unique` (delivery_id, attempt_number)
- INDEX `email_delivery_attempts_provider_message_id_index` (provider_message_id)

**Foreign keys**

- `delivery_id` → `email_deliveries.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `email_delivery_attempts_delivery_id_foreign`

## email_notification_settings

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| tenant_id | `bigint(20) unsigned` | yes | `NULL` |  |
| template_key | `varchar(191)` | no | — |  |
| enabled | `tinyint(1)` | no | `1` |  |
| category | `varchar(191)` | no | `'general'` |  |
| name | `varchar(191)` | no | — |  |
| description | `text` | yes | `NULL` |  |
| rate_limit_exempt | `tinyint(1)` | no | `0` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `email_notification_settings_category_enabled_index` (category, enabled)
- INDEX `email_notification_settings_category_index` (category)
- UNIQUE `email_notification_settings_template_key_unique` (template_key)
- INDEX `email_notification_settings_tenant_id_index` (tenant_id)

## email_quotas

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| tenant_id | `bigint(20) unsigned` | yes | `NULL` |  |
| user_id | `bigint(20) unsigned` | no | — |  |
| plan | `varchar(191)` | no | `'free'` |  |
| monthly_limit | `int(11)` | no | `3000` |  |
| daily_limit | `int(11)` | yes | `100` |  |
| monthly_sent | `int(11)` | no | `0` |  |
| daily_sent | `int(11)` | no | `0` |  |
| day_sent_count | `int(11)` | no | `0` |  |
| month_sent_count | `int(11)` | no | `0` |  |
| monthly_overage | `int(11)` | no | `0` |  |
| overage_count | `int(11)` | no | `0` |  |
| month_reset_at | `date` | no | `'2026-07-13'` |  |
| day_reset_at | `date` | no | `'2026-07-13'` |  |
| period_month | `varchar(7)` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `email_quotas_day_reset_at_index` (day_reset_at)
- INDEX `email_quotas_month_reset_at_index` (month_reset_at)
- INDEX `email_quotas_period_month_index` (period_month)
- INDEX `email_quotas_tenant_id_index` (tenant_id)
- INDEX `email_quotas_user_id_index` (user_id)
- INDEX `email_quotas_user_id_plan_index` (user_id, plan)
- UNIQUE `email_quotas_user_id_unique` (user_id)

## extension_configs

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| extension_id | `varchar(191)` | no | — |  |
| enabled | `tinyint(1)` | no | `0` |  |
| allowed_nests | `longtext` | yes | `NULL` |  |
| allowed_eggs | `longtext` | yes | `NULL` |  |
| settings | `longtext` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `extension_configs_extension_id_index` (extension_id)
- UNIQUE `extension_configs_extension_id_unique` (extension_id)

## extension_file_snapshots

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| server_id | `int(10) unsigned` | no | — |  |
| actor_id | `int(10) unsigned` | yes | `NULL` |  |
| extension_id | `varchar(191)` | no | — |  |
| action | `varchar(191)` | no | — |  |
| files | `longtext` | no | — |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `extension_file_snapshots_action_index` (action)
- INDEX `extension_file_snapshots_actor_id_index` (actor_id)
- INDEX `extension_file_snapshots_extension_id_index` (extension_id)
- INDEX `extension_file_snapshots_server_id_index` (server_id)

**Foreign keys**

- `actor_id` → `users.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `extension_file_snapshots_actor_id_foreign`
- `server_id` → `servers.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `extension_file_snapshots_server_id_foreign`

## extension_packages

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| extension_id | `varchar(191)` | no | — |  |
| package_id | `varchar(191)` | no | — |  |
| name | `varchar(191)` | no | — |  |
| description | `text` | yes | `NULL` |  |
| author | `varchar(191)` | yes | `NULL` |  |
| icon | `varchar(191)` | no | `'puzzle'` |  |
| route | `varchar(191)` | yes | `NULL` |  |
| installed_version | `varchar(191)` | no | — |  |
| source_repository_id | `bigint(20) unsigned` | yes | `NULL` |  |
| source_repository_name | `varchar(191)` | yes | `NULL` |  |
| source_registry_url | `text` | yes | `NULL` |  |
| source_archive_url | `text` | yes | `NULL` |  |
| package_checksum | `varchar(64)` | yes | `NULL` |  |
| manifest | `longtext` | no | — |  |
| installed_at | `timestamp` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `extension_packages_extension_id_unique` (extension_id)
- INDEX `extension_packages_package_id_index` (package_id)
- INDEX `extension_packages_source_repository_id_foreign` (source_repository_id)

**Foreign keys**

- `source_repository_id` → `extension_repositories.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `extension_packages_source_repository_id_foreign`

## extension_package_files

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| extension_package_id | `bigint(20) unsigned` | no | — |  |
| path | `varchar(191)` | no | — |  |
| operation | `varchar(191)` | no | — |  |
| installed_checksum | `varchar(64)` | no | — |  |
| backup_path | `text` | yes | `NULL` |  |
| backup_checksum | `varchar(64)` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `extension_package_files_extension_package_id_foreign` (extension_package_id)
- UNIQUE `extension_package_files_path_unique` (path)

**Foreign keys**

- `extension_package_id` → `extension_packages.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `extension_package_files_extension_package_id_foreign`

## extension_repositories

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| slug | `varchar(191)` | no | — |  |
| name | `varchar(191)` | no | — |  |
| manifest_url | `text` | no | — |  |
| homepage_url | `text` | yes | `NULL` |  |
| enabled | `tinyint(1)` | no | `1` |  |
| is_official | `tinyint(1)` | no | `0` |  |
| risk_acknowledged_at | `timestamp` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `extension_repositories_slug_unique` (slug)

## failed_jobs

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| uuid | `varchar(191)` | yes | `NULL` |  |
| connection | `text` | no | — |  |
| queue | `text` | no | — |  |
| payload | `longtext` | no | — |  |
| failed_at | `timestamp` | no | — |  |
| exception | `text` | no | — |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `failed_jobs_uuid_unique` (uuid)

## invoices

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| uuid | `char(36)` | no | — |  |
| order_id | `bigint(20) unsigned` | no | — |  |
| user_id | `int(10) unsigned` | no | — |  |
| invoice_number | `varchar(30)` | no | — |  |
| status | `varchar(20)` | no | `'active'` |  |
| data_path | `varchar(191)` | yes | `NULL` |  |
| data_disk | `varchar(20)` | yes | `NULL` |  |
| data_size_bytes | `bigint(20) unsigned` | yes | `NULL` |  |
| pdf_cached_path | `varchar(191)` | yes | `NULL` |  |
| pdf_cached_at | `timestamp` | yes | `NULL` |  |
| pdf_expires_at | `timestamp` | yes | `NULL` |  |
| total | `decimal(10,2)` | no | — |  |
| currency | `varchar(10)` | no | `'USD'` |  |
| generated_at | `timestamp` | yes | `NULL` |  |
| expires_at | `timestamp` | yes | `NULL` |  |
| voided_at | `timestamp` | yes | `NULL` |  |
| voided_by | `int(10) unsigned` | yes | `NULL` |  |
| voided_reason | `varchar(191)` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `invoices_invoice_number_unique` (invoice_number)
- INDEX `invoices_order_id_index` (order_id)
- INDEX `invoices_pdf_expires_at_index` (pdf_expires_at)
- INDEX `invoices_status_expires_at_index` (status, expires_at)
- INDEX `invoices_user_id_status_index` (user_id, status)
- UNIQUE `invoices_uuid_unique` (uuid)

**Foreign keys**

- `order_id` → `orders.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `invoices_order_id_foreign`
- `user_id` → `users.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `invoices_user_id_foreign`

## invoice_settings

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| company_name | `varchar(191)` | no | `''` |  |
| company_address | `varchar(191)` | no | `''` |  |
| company_city | `varchar(191)` | no | `''` |  |
| company_state | `varchar(191)` | no | `''` |  |
| company_zip | `varchar(191)` | no | `''` |  |
| company_country | `varchar(191)` | no | `''` |  |
| company_logo_url | `varchar(191)` | yes | `NULL` |  |
| company_tax_id | `varchar(191)` | yes | `NULL` |  |
| invoice_prefix | `varchar(20)` | no | `'INV'` |  |
| invoice_sequence | `int(10) unsigned` | no | `0` |  |
| storage_driver | `varchar(20)` | no | `'local'` |  |
| storage_config | `text` | yes | `NULL` |  |
| r2_bytes_used | `bigint(20) unsigned` | no | `0` |  |
| r2_bytes_limit | `bigint(20) unsigned` | no | `10200547328` |  |
| auto_cleanup_enabled | `tinyint(1)` | no | `0` |  |
| auto_cleanup_after_years | `smallint(5) unsigned` | no | `3` |  |
| require_billing_address | `tinyint(1)` | no | `0` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)

## jguard_delay

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| user_id | `int(10) unsigned` | no | — |  |
| status | `varchar(16)` | no | `'approved'` |  |
| approval_mode | `varchar(16)` | no | `'manual'` |  |
| expires_at | `datetime` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `jguard_delay_user_id_foreign` (user_id)

**Foreign keys**

- `user_id` → `users.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `jguard_delay_user_id_foreign`

## jobs

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| queue | `varchar(191)` | no | — |  |
| payload | `longtext` | no | — |  |
| attempts | `tinyint(3) unsigned` | no | — |  |
| reserved_at | `int(10) unsigned` | yes | `NULL` |  |
| available_at | `int(10) unsigned` | no | — |  |
| created_at | `int(10) unsigned` | no | — |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `jobs_queue_reserved_at_index` (queue, reserved_at)

## marketplace_install_logs

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| provider | `varchar(64)` | no | — |  |
| type | `varchar(32)` | no | — |  |
| project_id | `varchar(128)` | no | — |  |
| file_size_bytes | `bigint(20) unsigned` | no | `0` |  |
| status | `varchar(16)` | no | — |  |
| server_id | `int(10) unsigned` | yes | `NULL` |  |
| user_id | `int(10) unsigned` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `marketplace_install_logs_provider_status_index` (provider, status)
- INDEX `marketplace_install_logs_server_id_index` (server_id)
- INDEX `marketplace_install_logs_status_created_at_index` (status, created_at)
- INDEX `marketplace_install_logs_user_id_index` (user_id)

**Foreign keys**

- `server_id` → `servers.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `marketplace_install_logs_server_id_foreign`
- `user_id` → `users.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `marketplace_install_logs_user_id_foreign`

## mounts

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| uuid | `char(36)` | no | — |  |
| name | `varchar(191)` | no | — |  |
| description | `text` | yes | `NULL` |  |
| source | `varchar(191)` | no | — |  |
| target | `varchar(191)` | no | — |  |
| read_only | `tinyint(3) unsigned` | no | — |  |
| user_mountable | `tinyint(3) unsigned` | no | — |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `mounts_id_unique` (id)
- UNIQUE `mounts_name_unique` (name)
- UNIQUE `mounts_uuid_unique` (uuid)

## mount_node

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| node_id | `int(10) unsigned` | no | — |  |
| mount_id | `int(10) unsigned` | no | — |  |

**Indexes**

- INDEX `mount_node_mount_id_foreign` (mount_id)
- UNIQUE `mount_node_node_id_mount_id_unique` (node_id, mount_id)

**Foreign keys**

- `mount_id` → `mounts.id` (ON DELETE CASCADE, ON UPDATE CASCADE) — `mount_node_mount_id_foreign`
- `node_id` → `nodes.id` (ON DELETE CASCADE, ON UPDATE CASCADE) — `mount_node_node_id_foreign`

## mount_server

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| server_id | `int(10) unsigned` | no | — |  |
| mount_id | `int(10) unsigned` | no | — |  |

**Indexes**

- INDEX `mount_server_mount_id_foreign` (mount_id)
- UNIQUE `mount_server_server_id_mount_id_unique` (server_id, mount_id)

**Foreign keys**

- `mount_id` → `mounts.id` (ON DELETE CASCADE, ON UPDATE CASCADE) — `mount_server_mount_id_foreign`
- `server_id` → `servers.id` (ON DELETE CASCADE, ON UPDATE CASCADE) — `mount_server_server_id_foreign`

## nests

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| uuid | `char(36)` | no | — |  |
| author | `varchar(191)` | no | — |  |
| name | `varchar(191)` | no | — |  |
| description | `text` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `services_uuid_unique` (uuid)

## nodes

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| uuid | `char(36)` | no | — |  |
| public | `smallint(5) unsigned` | no | — |  |
| name | `varchar(191)` | no | — |  |
| description | `text` | yes | `NULL` |  |
| database_host_id | `int(10) unsigned` | yes | `NULL` |  |
| fqdn | `varchar(191)` | no | — |  |
| listen_port_http | `int(10) unsigned` | no | `8080` |  |
| listen_port_sftp | `int(10) unsigned` | no | `2022` |  |
| public_port_http | `int(10) unsigned` | no | `8080` |  |
| public_port_sftp | `int(10) unsigned` | no | `2022` |  |
| scheme | `varchar(191)` | no | `'https'` |  |
| behind_proxy | `tinyint(1)` | no | `0` |  |
| maintenance_mode | `tinyint(1)` | no | `0` |  |
| wings_type | `varchar(20)` | no | `'default'` |  |
| wings_version | `varchar(50)` | yes | `NULL` |  |
| wings_detected_at | `timestamp` | yes | `NULL` |  |
| memory | `int(10) unsigned` | no | — |  |
| memory_overallocate | `int(11)` | no | `0` |  |
| disk | `int(10) unsigned` | no | — |  |
| disk_overallocate | `int(11)` | no | `0` |  |
| upload_size | `int(10) unsigned` | no | `100` |  |
| daemon_token_id | `char(16)` | no | — |  |
| daemon_token | `text` | no | — |  |
| daemon_base | `varchar(191)` | no | `'/home/daemon-files'` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |
| deployable | `tinyint(1)` | yes | `0` |  |
| deployable_free | `tinyint(1)` | yes | `0` |  |
| price_multiplier | `decimal(5,2)` | no | `1.00` |  |
| price_multiplier_description | `varchar(500)` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `nodes_daemon_token_id_unique` (daemon_token_id)
- INDEX `nodes_database_host_id_index` (database_host_id)
- UNIQUE `nodes_uuid_unique` (uuid)

**Foreign keys**

- `database_host_id` → `database_hosts.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `nodes_database_host_id_foreign`

## notifications

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `varchar(191)` | no | — |  |
| type | `varchar(191)` | no | — |  |
| notifiable_type | `varchar(191)` | no | — |  |
| notifiable_id | `bigint(20) unsigned` | no | — |  |
| data | `text` | no | — |  |
| read_at | `timestamp` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `notifications_notifiable_type_notifiable_id_index` (notifiable_type, notifiable_id)

## orders

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| name | `varchar(191)` | no | — |  |
| user_id | `int(10) unsigned` | no | — |  |
| description | `varchar(191)` | no | — |  |
| total | `double` | no | — |  |
| subtotal | `decimal(10,2)` | yes | `NULL` |  |
| discount | `decimal(10,2)` | yes | `NULL` |  |
| status | `varchar(191)` | no | — |  |
| product_id | `int(10) unsigned` | no | — |  |
| product_name | `varchar(191)` | yes | `NULL` |  |
| billing_days | `int(11)` | yes | `NULL` |  |
| final_price | `decimal(10,2)` | yes | `NULL` |  |
| multiplier_used | `decimal(5,4)` | yes | `NULL` |  |
| node_multiplier_used | `decimal(5,2)` | yes | `NULL` |  |
| egg_id | `int(10) unsigned` | yes | `NULL` |  |
| node_id | `int(11)` | yes | `NULL` |  |
| server_id | `int(11)` | yes | `NULL` |  |
| variables | `longtext` | yes | `NULL` |  |
| domain_payload | `longtext` | yes | `NULL` |  |
| coupon_id | `bigint(20) unsigned` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |
| payment_intent_id | `varchar(191)` | yes | `NULL` |  |
| payment_processor | `varchar(191)` | no | `'stripe'` |  |
| paypal_order_id | `varchar(191)` | yes | `NULL` |  |
| paypal_capture_id | `varchar(191)` | yes | `NULL` |  |
| paypal_payer_id | `varchar(191)` | yes | `NULL` |  |
| paypal_payer_email | `varchar(191)` | yes | `NULL` |  |
| paypal_status | `varchar(191)` | yes | `NULL` |  |
| paypal_amount | `decimal(10,2)` | yes | `NULL` |  |
| paypal_currency | `varchar(3)` | yes | `NULL` |  |
| paypal_captured_at | `timestamp` | yes | `NULL` |  |
| payment_token | `varchar(191)` | yes | `NULL` |  |
| threat_index | `int(11)` | no | `-1` |  |
| type | `varchar(191)` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `orders_coupon_id_foreign` (coupon_id)
- INDEX `orders_egg_id_foreign` (egg_id)
- INDEX `orders_payment_token_index` (payment_token)
- INDEX `orders_paypal_order_id_index` (paypal_order_id)
- INDEX `orders_user_id_index` (user_id)

**Foreign keys**

- `coupon_id` → `coupons.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `orders_coupon_id_foreign`
- `egg_id` → `eggs.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `orders_egg_id_foreign`

## password_resets

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| email | `varchar(191)` | no | — |  |
| token | `varchar(191)` | no | — |  |
| created_at | `timestamp` | no | — |  |

**Indexes**

- INDEX `password_resets_email_index` (email)
- INDEX `password_resets_token_index` (token)

## password_reset_tokens

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| email | `varchar(191)` | no | — |  |
| token | `varchar(191)` | no | — |  |
| created_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (email)

## payment_transactions

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| order_id | `bigint(20) unsigned` | no | — |  |
| processor | `varchar(191)` | no | — |  |
| external_id | `varchar(191)` | yes | `NULL` |  |
| capture_id | `varchar(191)` | yes | `NULL` |  |
| status | `varchar(191)` | yes | `NULL` |  |
| amount | `decimal(10,2)` | yes | `NULL` |  |
| currency | `varchar(10)` | yes | `NULL` |  |
| payer_id | `varchar(191)` | yes | `NULL` |  |
| payer_email | `varchar(191)` | yes | `NULL` |  |
| payment_token | `varchar(191)` | yes | `NULL` |  |
| raw_metadata | `longtext` | yes | `NULL` |  |
| captured_at | `timestamp` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `payment_transactions_order_id_index` (order_id)
- INDEX `payment_transactions_payment_token_index` (payment_token)
- INDEX `payment_transactions_processor_external_id_index` (processor, external_id)

**Foreign keys**

- `order_id` → `orders.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `payment_transactions_order_id_foreign`

## plugin_provider_rules

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| provider_key | `varchar(191)` | no | — |  |
| enabled_global | `tinyint(1)` | no | `0` |  |
| allowed_nest_ids | `longtext` | yes | `NULL` |  |
| allowed_egg_ids | `longtext` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `plugin_provider_rules_provider_key_unique` (provider_key)

## products

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| uuid | `char(36)` | no | — |  |
| name | `varchar(191)` | no | — |  |
| icon | `varchar(191)` | yes | `NULL` |  |
| price | `double` | no | — |  |
| base_price | `decimal(10,2)` | yes | `NULL` |  |
| description | `varchar(191)` | yes | `NULL` |  |
| visible | `tinyint(1)` | yes | `NULL` |  |
| cpu_limit | `int(10) unsigned` | no | — |  |
| memory_limit | `int(11)` | no | — |  |
| disk_limit | `int(11)` | no | — |  |
| backup_limit | `int(10) unsigned` | no | — |  |
| database_limit | `int(10) unsigned` | no | — |  |
| allocation_limit | `int(10) unsigned` | no | — |  |
| subdomain_limit | `int(10) unsigned` | yes | `1` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |
| stripe_id | `varchar(191)` | yes | `NULL` |  |
| category_uuid | `char(36)` | no | — |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `products_category_uuid_index` (category_uuid)

## recovery_tokens

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| user_id | `int(10) unsigned` | no | — |  |
| token | `varchar(191)` | no | — |  |
| created_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `recovery_tokens_user_id_foreign` (user_id)

**Foreign keys**

- `user_id` → `users.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `recovery_tokens_user_id_foreign`

## resend_quotas

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| daily_sent | `int(10) unsigned` | no | `0` |  |
| monthly_sent | `int(10) unsigned` | no | `0` |  |
| day_reset_at | `date` | yes | `NULL` |  |
| month_reset_at | `date` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)

## schedules

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| server_id | `int(10) unsigned` | no | — |  |
| name | `varchar(191)` | no | — |  |
| cron_day_of_week | `varchar(191)` | no | — |  |
| cron_month | `varchar(191)` | no | — |  |
| cron_day_of_month | `varchar(191)` | no | — |  |
| cron_hour | `varchar(191)` | no | — |  |
| cron_minute | `varchar(191)` | no | — |  |
| is_active | `tinyint(1)` | no | — |  |
| is_processing | `tinyint(1)` | no | — |  |
| only_when_online | `tinyint(3) unsigned` | no | `0` |  |
| last_run_at | `timestamp` | yes | `NULL` |  |
| next_run_at | `timestamp` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `schedules_server_id_foreign` (server_id)

**Foreign keys**

- `server_id` → `servers.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `schedules_server_id_foreign`

## servers

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| external_id | `varchar(191)` | yes | `NULL` |  |
| uuid | `char(36)` | no | — |  |
| uuidShort | `char(8)` | no | — |  |
| node_id | `int(10) unsigned` | no | — |  |
| name | `varchar(191)` | no | — |  |
| description | `text` | no | — |  |
| mods_enabled | `tinyint(1)` | no | `0` |  |
| status | `varchar(191)` | yes | `NULL` |  |
| skip_scripts | `tinyint(1)` | no | `0` |  |
| owner_id | `int(10) unsigned` | no | — |  |
| memory | `int(10) unsigned` | no | — |  |
| swap | `int(11)` | no | — |  |
| disk | `int(10) unsigned` | no | — |  |
| io | `int(10) unsigned` | no | — |  |
| cpu | `int(10) unsigned` | no | — |  |
| threads | `varchar(191)` | yes | `NULL` |  |
| oom_killer | `tinyint(3) unsigned` | no | `1` |  |
| allocation_id | `int(10) unsigned` | no | — |  |
| nest_id | `int(10) unsigned` | no | — |  |
| egg_id | `int(10) unsigned` | no | — |  |
| startup | `text` | yes | `NULL` |  |
| image | `varchar(191)` | no | — |  |
| allocation_limit | `int(10) unsigned` | yes | `NULL` |  |
| database_limit | `int(10) unsigned` | yes | `0` |  |
| backup_limit | `int(10) unsigned` | no | `0` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |
| installed_at | `timestamp` | yes | `NULL` |  |
| subuser_limit | `int(11)` | yes | `-1` |  |
| subdomain_limit | `int(10) unsigned` | yes | `1` |  |
| renewal_date | `datetime` | yes | `NULL` |  |
| deletion_scheduled_at | `timestamp` | yes | `NULL` |  |
| deletion_scheduled_by | `bigint(20) unsigned` | yes | `NULL` |  |
| deletion_canceled_at | `timestamp` | yes | `NULL` |  |
| last_plan_change_at | `timestamp` | yes | `NULL` |  |
| billing_product_id | `int(10) unsigned` | yes | `NULL` |  |
| billing_days | `int(11)` | yes | `NULL` |  |
| billing_amount | `decimal(10,2)` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `servers_allocation_id_unique` (allocation_id)
- INDEX `servers_egg_id_foreign` (egg_id)
- UNIQUE `servers_external_id_unique` (external_id)
- INDEX `servers_nest_id_foreign` (nest_id)
- INDEX `servers_node_id_foreign` (node_id)
- INDEX `servers_owner_id_foreign` (owner_id)
- INDEX `servers_renewal_date_index` (renewal_date)
- INDEX `servers_status_index` (status)
- UNIQUE `servers_uuidshort_unique` (uuidShort)
- UNIQUE `servers_uuid_unique` (uuid)

**Foreign keys**

- `allocation_id` → `allocations.id` (ON DELETE RESTRICT, ON UPDATE RESTRICT) — `servers_allocation_id_foreign`
- `egg_id` → `eggs.id` (ON DELETE RESTRICT, ON UPDATE RESTRICT) — `servers_egg_id_foreign`
- `nest_id` → `nests.id` (ON DELETE RESTRICT, ON UPDATE RESTRICT) — `servers_nest_id_foreign`
- `node_id` → `nodes.id` (ON DELETE RESTRICT, ON UPDATE RESTRICT) — `servers_node_id_foreign`
- `owner_id` → `users.id` (ON DELETE RESTRICT, ON UPDATE RESTRICT) — `servers_owner_id_foreign`

## server_custom_domains

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| server_id | `int(10) unsigned` | no | — |  |
| allocation_id | `int(10) unsigned` | yes | `NULL` |  |
| custom_domain_id | `bigint(20) unsigned` | no | — |  |
| subdomain | `varchar(191)` | no | — |  |
| full_domain | `varchar(191)` | no | — |  |
| port | `int(10) unsigned` | no | — |  |
| protocol | `enum('tcp','udp','both')` | no | `'both'` |  |
| record_type | `enum('srv','cname')` | yes | `NULL` |  |
| service_tag | `varchar(191)` | yes | `NULL` |  |
| status | `enum('pending','active','failed')` | no | `'pending'` |  |
| dns_records | `longtext` | yes | `NULL` |  |
| last_error | `text` | yes | `NULL` |  |
| last_synced_at | `timestamp` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `server_custom_domains_allocation_id_index` (allocation_id)
- INDEX `server_custom_domains_custom_domain_id_foreign` (custom_domain_id)
- INDEX `server_custom_domains_server_id_status_index` (server_id, status)
- UNIQUE `server_custom_domains_unique_target` (full_domain, port, protocol)

**Foreign keys**

- `allocation_id` → `allocations.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `server_custom_domains_allocation_id_foreign`
- `custom_domain_id` → `custom_domains.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `server_custom_domains_custom_domain_id_foreign`
- `server_id` → `servers.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `server_custom_domains_server_id_foreign`

## server_groups

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| user_id | `int(10) unsigned` | no | — |  |
| name | `varchar(191)` | no | — |  |
| color | `varchar(191)` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)

## server_group_members

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| server_id | `int(10) unsigned` | no | — |  |
| server_group_id | `bigint(20) unsigned` | no | — |  |

**Indexes**

- PRIMARY `PRIMARY` (server_id, server_group_id)
- INDEX `server_group_members_server_group_id_foreign` (server_group_id)

**Foreign keys**

- `server_group_id` → `server_groups.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `server_group_members_server_group_id_foreign`
- `server_id` → `servers.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `server_group_members_server_id_foreign`

## server_presets

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| uuid | `char(36)` | no | — |  |
| name | `varchar(191)` | no | — |  |
| description | `text` | yes | `NULL` |  |
| cpu | `int(10) unsigned` | no | — |  |
| memory | `int(11)` | no | — |  |
| disk | `int(11)` | no | — |  |
| nest_id | `int(10) unsigned` | yes | `NULL` |  |
| egg_id | `int(10) unsigned` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `server_presets_egg_id_foreign` (egg_id)
- INDEX `server_presets_nest_id_foreign` (nest_id)
- UNIQUE `server_presets_uuid_unique` (uuid)

**Foreign keys**

- `egg_id` → `eggs.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `server_presets_egg_id_foreign`
- `nest_id` → `nests.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `server_presets_nest_id_foreign`

## server_transfers

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| server_id | `int(10) unsigned` | no | — |  |
| successful | `tinyint(1)` | yes | `NULL` |  |
| old_node | `int(10) unsigned` | no | — |  |
| new_node | `int(10) unsigned` | no | — |  |
| old_allocation | `int(10) unsigned` | no | — |  |
| new_allocation | `int(10) unsigned` | no | — |  |
| old_additional_allocations | `longtext` | yes | `NULL` |  |
| new_additional_allocations | `longtext` | yes | `NULL` |  |
| archived | `tinyint(1)` | no | `0` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `server_transfers_server_id_foreign` (server_id)

**Foreign keys**

- `server_id` → `servers.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `server_transfers_server_id_foreign`

## server_variables

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| server_id | `int(10) unsigned` | yes | `NULL` |  |
| variable_id | `int(10) unsigned` | no | — |  |
| variable_value | `text` | no | — |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `server_variables_server_id_foreign` (server_id)
- INDEX `server_variables_variable_id_foreign` (variable_id)

**Foreign keys**

- `server_id` → `servers.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `server_variables_server_id_foreign`
- `variable_id` → `egg_variables.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `server_variables_variable_id_foreign`

## sessions

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `varchar(191)` | no | — |  |
| user_id | `int(11)` | yes | `NULL` |  |
| ip_address | `varchar(45)` | yes | `NULL` |  |
| user_agent | `text` | yes | `NULL` |  |
| payload | `text` | no | — |  |
| last_activity | `int(11)` | no | — |  |

**Indexes**

- UNIQUE `sessions_id_unique` (id)

## settings

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| key | `varchar(191)` | no | — |  |
| value | `text` | no | — |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `settings_key_unique` (key)

## subscriptions

> **OMITTED FROM REBUILD** (D2, 2026-07-20): dead Cashier-style table, zero code
> references. Shape kept for reference only.

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| user_id | `bigint(20) unsigned` | no | — |  |
| type | `varchar(191)` | no | — |  |
| stripe_id | `varchar(191)` | no | — |  |
| stripe_status | `varchar(191)` | no | — |  |
| stripe_price | `varchar(191)` | yes | `NULL` |  |
| quantity | `int(11)` | yes | `NULL` |  |
| trial_ends_at | `timestamp` | yes | `NULL` |  |
| ends_at | `timestamp` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `subscriptions_stripe_id_unique` (stripe_id)
- INDEX `subscriptions_user_id_stripe_status_index` (user_id, stripe_status)

## subscription_items

> **OMITTED FROM REBUILD** (D2, 2026-07-20): dead Cashier-style table, zero code
> references. Shape kept for reference only.

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| subscription_id | `bigint(20) unsigned` | no | — |  |
| stripe_id | `varchar(191)` | no | — |  |
| stripe_product | `varchar(191)` | no | — |  |
| stripe_price | `varchar(191)` | no | — |  |
| quantity | `int(11)` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `subscription_items_stripe_id_unique` (stripe_id)
- INDEX `subscription_items_subscription_id_stripe_price_index` (subscription_id, stripe_price)

## subusers

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| user_id | `int(10) unsigned` | no | — |  |
| server_id | `int(10) unsigned` | no | — |  |
| permissions | `longtext` | yes | `NULL` |  |
| disabled_extensions | `longtext` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `subusers_server_id_foreign` (server_id)
- INDEX `subusers_user_id_foreign` (user_id)

**Foreign keys**

- `server_id` → `servers.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `subusers_server_id_foreign`
- `user_id` → `users.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `subusers_user_id_foreign`

## tasks

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| schedule_id | `int(10) unsigned` | no | — |  |
| sequence_id | `int(10) unsigned` | no | — |  |
| action | `varchar(191)` | no | — |  |
| payload | `text` | no | — |  |
| time_offset | `int(10) unsigned` | no | — |  |
| is_queued | `tinyint(1)` | no | — |  |
| continue_on_failure | `tinyint(3) unsigned` | no | `0` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `tasks_schedule_id_sequence_id_index` (schedule_id, sequence_id)

**Foreign keys**

- `schedule_id` → `schedules.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `tasks_schedule_id_foreign`

## tasks_log

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| task_id | `int(10) unsigned` | no | — |  |
| run_time | `timestamp` | no | — |  |
| run_status | `int(10) unsigned` | no | — |  |
| response | `text` | no | — |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)

## theme

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| key | `varchar(191)` | no | — |  |
| value | `text` | no | — |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `theme_key_unique` (key)

## theme_presets

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| name | `varchar(191)` | no | — |  |
| colors | `longtext` | no | — |  |
| is_builtin | `tinyint(1)` | no | `0` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)

## tickets

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| title | `varchar(191)` | no | — |  |
| status | `varchar(191)` | no | — |  |
| priority | `enum('low','medium','high','critical')` | no | `'medium'` |  |
| last_reply_at | `timestamp` | yes | `NULL` |  |
| user_id | `int(10) unsigned` | no | — |  |
| assigned_to | `int(10) unsigned` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `tickets_assigned_to_index` (assigned_to)
- INDEX `tickets_created_at_index` (created_at)
- INDEX `tickets_last_reply_at_index` (last_reply_at)
- INDEX `tickets_priority_index` (priority)
- INDEX `tickets_status_index` (status)
- INDEX `tickets_user_id_index` (user_id)

**Foreign keys**

- `assigned_to` → `users.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `tickets_assigned_to_foreign`
- `user_id` → `users.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `tickets_user_id_foreign`

## ticket_messages

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| user_id | `int(10) unsigned` | no | — |  |
| ticket_id | `int(10) unsigned` | no | — |  |
| message | `text` | no | — |  |
| internal_note | `tinyint(1)` | no | `0` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `ticket_messages_ticket_id_internal_note_index` (ticket_id, internal_note)

## users

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| external_id | `varchar(191)` | yes | `NULL` |  |
| uuid | `char(36)` | no | — |  |
| username | `varchar(191)` | no | — |  |
| email | `varchar(191)` | no | — |  |
| email_verified_at | `timestamp` | yes | `NULL` |  |
| email_verification_token | `varchar(100)` | yes | `NULL` |  |
| password | `text` | no | — |  |
| remember_token | `varchar(191)` | yes | `NULL` |  |
| language | `varchar(5)` | yes | `NULL` |  |
| admin_role_id | `int(10) unsigned` | yes | `NULL` |  |
| root_admin | `tinyint(3) unsigned` | no | `0` |  |
| use_totp | `tinyint(3) unsigned` | no | — |  |
| totp_secret | `text` | yes | `NULL` |  |
| totp_authenticated_at | `timestamp` | yes | `NULL` |  |
| gravatar | `tinyint(1)` | no | `1` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |
| stripe_id | `varchar(191)` | yes | `NULL` |  |
| pm_type | `varchar(191)` | yes | `NULL` |  |
| pm_last_four | `varchar(4)` | yes | `NULL` |  |
| trial_ends_at | `timestamp` | yes | `NULL` |  |
| state | `varchar(191)` | yes | `NULL` |  |
| recovery_code | `varchar(191)` | yes | `NULL` |  |
| recovery_code_seen | `tinyint(1)` | yes | `0` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `users_admin_role_id_index` (admin_role_id)
- UNIQUE `users_email_unique` (email)
- INDEX `users_external_id_index` (external_id)
- INDEX `users_stripe_id_index` (stripe_id)
- UNIQUE `users_username_unique` (username)
- UNIQUE `users_uuid_unique` (uuid)

**Foreign keys**

- `admin_role_id` → `admin_roles.id` (ON DELETE SET NULL, ON UPDATE RESTRICT) — `users_admin_role_id_foreign`

## user_billing_profiles

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| user_id | `int(10) unsigned` | no | — |  |
| encrypted_data | `text` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- UNIQUE `user_billing_profiles_user_id_unique` (user_id)

**Foreign keys**

- `user_id` → `users.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `user_billing_profiles_user_id_foreign`

## user_sessions

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| user_id | `int(10) unsigned` | no | — |  |
| session_id | `varchar(191)` | no | — |  |
| device_fingerprint | `varchar(191)` | no | — |  |
| device_name | `varchar(191)` | yes | `NULL` |  |
| device_label | `varchar(100)` | yes | `NULL` |  |
| user_agent | `text` | yes | `NULL` |  |
| ip_address | `varchar(45)` | yes | `NULL` |  |
| location | `varchar(191)` | yes | `NULL` |  |
| last_activity_at | `timestamp` | yes | `NULL` |  |
| last_notified_at | `timestamp` | yes | `NULL` |  |
| revoked_at | `timestamp` | yes | `NULL` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `user_sessions_revoked_at_index` (revoked_at)
- INDEX `user_sessions_session_id_index` (session_id)
- INDEX `user_sessions_user_id_device_fingerprint_index` (user_id, device_fingerprint)
- UNIQUE `user_sessions_user_id_session_id_unique` (user_id, session_id)

## user_ssh_keys

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `int(10) unsigned` | no | — | auto_increment |
| user_id | `int(10) unsigned` | no | — |  |
| name | `varchar(191)` | no | — |  |
| fingerprint | `varchar(191)` | no | — |  |
| public_key | `text` | no | — |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |
| deleted_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)
- INDEX `user_ssh_keys_user_id_foreign` (user_id)

**Foreign keys**

- `user_id` → `users.id` (ON DELETE CASCADE, ON UPDATE RESTRICT) — `user_ssh_keys_user_id_foreign`

## webhook_events

| Column | Type | Nullable | Default | Extra |
|---|---|---|---|---|
| id | `bigint(20) unsigned` | no | — | auto_increment |
| key | `varchar(191)` | no | — |  |
| description | `text` | no | — |  |
| enabled | `tinyint(1)` | no | `0` |  |
| created_at | `timestamp` | yes | `NULL` |  |
| updated_at | `timestamp` | yes | `NULL` |  |

**Indexes**

- PRIMARY `PRIMARY` (id)

