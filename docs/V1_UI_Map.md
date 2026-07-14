# M12Labs Panel — V1 UI Map

> Source: `resources/` (frontend only). 866 files — 532 `.tsx`, 270 `.ts`, 50 `.php`, 8 `.css`.
> This documents the **existing** UI so the rewrite has a complete reference. No code here is meant to be reused.

---

## 1. Stack (what's actually running)

| Concern | V1 choice | Notes for rewrite |
|---|---|---|
| Renderer | **Preact** via `preact/compat`, mounted at `#app` | Code is written to React API already |
| Routing | `react-router-dom` | Lazy-loaded route containers |
| State | **easy-peasy** (`createStore`) | 26 store slices, server + UI state mixed |
| Data fetching | **axios** (`api/http.ts`), Fractal JSON:API | Responses are `{ object, attributes, relationships }` |
| Forms | **Formik** (`FormikSwitch`, `FormikFieldWrapper`, `Field`) | |
| Styling | **tailwind** + **styled-components** + **twin.macro** | ⚠️ twin.macro = the babel dependency (255 files) |
| i18n | **i18next** (`i18n.ts` + `lang/en/*.php`-derived) | |
| Icons | `@heroicons/react/outline` | |
| Captcha | Cloudflare **Turnstile** | Loaded conditionally from blade |
| Payments | **Stripe** + **PayPal** | |
| Build | Vite | |

### Bootstrap (Blade → JS handoff)
`resources/views/templates/wrapper.blade.php` injects globals before the SPA boots:

- `window.PterodactylUser` — current user (`Auth::user()->toReactObject()`)
- `window.SiteConfiguration` — site/feature flags, captcha keys
- `window.EverestConfiguration` — Jexactyl/Everest module flags
- `window.ThemeConfiguration` — theme colors
- `window.FlashMessages` — server-side flashes
- `<meta name="csrf-token">` — CSRF token for axios

These globals are the contract the new UI must keep reading (or replace with a `/api/client/me` bootstrap endpoint — see rewrite doc).

---

## 2. Top-level routers

Four routers, each its own layout + sidebar:

| Router | Mount | Layout |
|---|---|---|
| `AuthenticationRouter` | `/auth/*` | Centered card, no chrome |
| `DashboardRouter` | `/` (account) | Top nav + account sidebar |
| `ServerRouter` | `/server/:id/*` | Top nav + server sidebar (category-grouped) |
| `AdminRouter` | `/admin/*` | Top nav + admin sidebar (category-grouped) |

Route definitions live in `routers/routes/{account,admin,server}.ts` as data (`route(path, Component, {name, icon, category, permission, condition})`). **This is the single most important file set for the rewrite** — it's already a declarative route registry. The new app should reproduce this pattern (one registry → drives both routing and nav).

---

## 3. Page map

Legend: `` = gated behind a feature flag/condition · `🔒` = gated behind a permission.

### 3.1 Auth (`/auth/*`)
| Route | Page | Does | Key endpoints (`api/routes/auth/*`) |
|---|---|---|---|
| `login` | Login | Email/password, Turnstile | `login.ts` |
| `login/checkpoint` | 2FA checkpoint | TOTP / recovery code | `login.ts` |
| `register`  | Register | Self-signup if enabled | `register.ts` |
| `discord/link-choice`  | Discord link | Link/create on Discord OAuth | `discord.ts` |
| `discord/register`  | Discord register | Finish Discord signup | `discord.ts` |
| `password` | Forgot password | Request reset email | `password-reset.ts` |
| `password/reset/:token` | Reset password | Set new password | `password-reset.ts` |
| `*` | NotFound | Redirects to login | — |

### 3.2 Account / Dashboard (`/`)
| Route | Page | Does | Endpoints (`api/routes/account/*`) |
|---|---|---|---|
| `` | Account Overview | Profile, email, password | `account/index.ts` |
| `credentials` | Credentials | API keys + SSH keys | `api-keys.ts`, `ssh-keys.ts` |
| `security` | Security | 2FA, active sessions | `two-factor.ts`, `sessions.ts` |
| `tickets`  | Tickets | List support tickets | `tickets.ts` |
| `tickets/:id`  | View Ticket | Thread + reply | `tickets.ts` |
| `billing/order`  | Products | Browse purchasable products | `billing/products.ts`, `categories.ts` |
| `checkout/configure/:id` | Configure order | Pick options/cycle | `billing/orders/*` |
| `checkout/payment` | Checkout payment | Pay (Stripe/PayPal) | `stripe.ts`, `paypal.ts`, `process.ts` |
| `billing/order/:id` | Order | Order detail/config | `billing/orders/index.ts` |
| `billing/orders`  | Orders | Order + invoice history | `invoices.ts`, `orders/index.ts` |
| `billing/processing` `/success` `/cancel` | Summary states | Post-payment status | `process.ts` |

Also referenced: `activity.ts` (account activity log), `billingProfile.ts`, `coupons.ts`, `customDomains.ts`, `addressAutocomplete.ts`, `email-verification.ts`, `modpacks.ts`.

### 3.3 Server (`/server/:id/*`) — sidebar grouped by `category`
| Route | Page | Category | Does | Endpoints (`api/routes/server/*`) |
|---|---|---|---|---|
| `` 🔒`control.console` | Console | — | Live console + power + stats (websocket) | `websocket.ts`, `index.ts` |
| `ai/*`  | AI Assistant | — | Per-server AI chat | `ai.ts`, `aiConversations.ts` |
| `files/*` 🔒`file.*` | Files | data | File manager | `files.ts`, `directories.ts` |
| `files/:action/*` 🔒 | File Edit | — | Edit/view a file | `files.ts` |
| `databases/*` 🔒`database.*` | Databases | data | DB list/create | `databases.ts` |
| `marketplace/*` 🔒`file.create` | Mods & Plugins | data | Browse/install mods | `mods.ts`, `plugins.ts`, `modpacks.ts` |
| `schedules/*` 🔒`schedule.*` | Schedules | configuration | Cron-like schedules | `schedules.ts`, `tasks.ts` |
| `schedules/:id/*` 🔒 | Schedule Edit | configuration | Tasks editor | `tasks.ts` |
| `users/*` 🔒`user.*` | Users (subusers) | configuration | Subusers + permissions | `subusers.ts`, `permissions.ts` |
| `backups/*` 🔒`backup.*` | Backups | data | Create/restore/download | `backups.ts` |
| `network/*` 🔒`allocation.*` | Network | configuration | Port allocations | `allocations.ts` |
| `custom-domains/*` 🔒 | Custom Domains | configuration | Domain mapping | `customDomains.ts` |
| `startup/*` 🔒`startup.*` | Startup | configuration | Startup vars / egg | `startup.ts` |
| `settings/*` 🔒`settings.*` | Settings | configuration | Rename, reinstall, SFTP | `index.ts`, `deletion.ts` |
| `activity/*` 🔒 | Activity | — | Server activity log | `activity.ts` |
| `billing/*` 🔒 | Billing | — | Renewal/cost for this server | `billing.ts` |
| `extensions/*` 🔒`extension.*` | Extensions | — | Per-server extension pages | `api/server/extensions/*` |

Server data shapes (`api/definitions/server/models.d.ts`): `Server`, `ServerStats`, `Backup`, `ServerGroup`, `EggVariable`, `Database`, `Subuser`, `Allocation`, `FileObject`, `Schedule`, `Task`.

### 3.4 Admin (`/admin/*`) — sidebar grouped by `category` (general / developers / modules / management / services)
| Route | Page | Category | 🔒 Permission |
|---|---|---|---|
| `` | Overview | general | `overview.read` |
| `settings/*` | Settings | general | `settings.read` |
| `activity`  | Activity | general | `activity.read` |
| `api/*` | API keys | general | `api.read` |
| `developers/api-docs` | API Docs | developers | — |
| `auth/*` | Auth module (JGuard) | modules | `auth.read` |
| `billing/*` | Billing module | modules | `billing.read` |
| `custom-domains/*` | Custom Domains | modules | `custom-domains.read` |
| `tickets/*` | Tickets | modules | `tickets.read` |
| `ai/*` | AI | modules | `ai.read` |
| `marketplace/*` `plugins/*` | Marketplace/Mods | modules | `mods.read` |
| `email/*` | Email | modules | (module) |
| `webhooks/*` | Webhooks | modules | (module) |
| `extensions/*` | Extensions | modules | (module) |
| `theme` | Theme | modules | (module) |
| `alerts/*` | Alerts | modules | (module) |
| `databases` `databases/:id` | Databases | management | `databases.read` |
| `nodes/*` `nodes/new` `nodes/:id/*` | Nodes | management | `nodes.read` |
| `servers` `servers/new` `servers/:id/*` | Servers | management | `servers.read` |
| `servers/presets` `servers/presets/:id/*` | Server Presets | management | `server-presets.read` |
| `users` `users/new` `users/:id/*` | Users | management | `users.read` |
| `roles` `roles/:id` | Roles | management | `roles.read` |
| `nests` `nests/:nestId` | Nests | services | `nests.read` |
| `nests/:nestId/new` | New Egg | services | `eggs.read` |
| `nests/:nestId/eggs/:id/*` | Egg Editor | services | `eggs.read` |

Admin data shapes (`api/definitions/admin/models.d.ts`): `User`, `UserRole`, `ApiKey`, `ApiKeyPermission`, `Ticket`, `TicketMessage`, `Order`, `Product`, `Category`, `Coupon`, `BillingCycle`, `BillingException`, `BillingAnalytics`, `BillingEvent`, `PaymentTransaction`, `SuspendedServer`, `ServerPreset`, `AdminRolePermission`.

Full admin endpoint surface is broad — see `api/routes/admin/{ai,alerts,api,auth,billing,customDomains,databases,eggs,email,extensions,links,mods,mounts,nests,nodes,plugins,roles,servers,settings,theme,tickets,users,webhooks}`.

---

## 4. Shared element library (`scripts/elements/`)

~60 primitives to rebuild. Grouped:

- **Layout/shell:** `NavigationBar`, `Sidebar`, `SubNavigation`, `MobileSidebar`, `MobileDrawer`, `PageContentBlock`, `ContentBox`, `ContentContainer`, `ScreenBlock`, `TitledGreyBox`, `GreyRowBox`, `AdminBox`, `AdminContentBlock`, `AdminTable`, `Table`
- **Inputs/forms:** `Input`, `Field`, `Label`, `Select`, `SelectField`, `SearchableSelect`, `Switch`, `Checkbox`, `AdminCheckbox`, `FormikSwitch`, `FormikFieldWrapper`, `InputError`, `InputSpinner`, `RequiredFieldIcon`, `Stepper`
- **Overlays:** `Modal`, `ConfirmationModal`, `MessageBox`, `DropdownMenu`, `SpeedDial`, `Portal`, dialog/dropdown/tooltip modules
- **Auth/permission gates:** `Can`, `PermissionRoute`, `AuthenticatedRoute`, `RequireAdminPermission`, `AdminAccessDenied`, `AdminReadOnlyBanner`, `AdminBypassButton`, `BypassModeHeader`
- **Feedback/util:** `Spinner`, `SpinnerOverlay`, `ProgressBar`, `Pagination`, `FlashMessageRender`, `Avatar`, `Code`, `CopyOnClick`, `Pill`, `Icon`/`DynamicIcon`, `Translate`, `ErrorBoundary`, `Unfinished` ← already a placeholder pattern

`Unfinished.tsx` already exists — the rewrite's shared placeholder is a direct descendant of this idea.

---

## 5. State stores (`scripts/state/`) — what to split in the rewrite

Mixed server + UI state in easy-peasy. In the new model these split cleanly:

**→ TanStack Query (server cache):** `admin/{allocations,api,databases,mounts,nests,nodes,roles,servers,tickets,users}`, `server/{databases,files,schedules,subusers}`, account data.

**→ Zustand (true global UI):** `user`, `theme`, `settings`, `flashes`, `everest`, `progress`, `permissions`, `server/socket` (websocket connection), `server/index` (active server context).

---

## 6. Feature flags & permissions (must carry over)

- **Flags** drive route visibility: `tickets.enabled`, `billing.enabled`, `aiEnabled`, `aiAssistantEnabled`, `activityEnabled`, `customDomainsEnabled`, `extensionsEnabled`, `billable`. Source: `window.EverestConfiguration` / `SiteConfiguration`.
- **Permissions** drive admin/server route access: dotted strings (`servers.read`, `file.*`, `control.console`, …) checked via `Can` / `PermissionRoute`. Source: `window.PterodactylUser` + per-server subuser permissions.

The new route registry must keep both `condition(flags)` and `permission` as first-class fields.
