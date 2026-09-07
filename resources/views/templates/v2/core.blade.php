<!DOCTYPE html>
<html lang="en">
    <head>
        <title>{{ config('app.name', 'Everest') }}</title>

        <meta charset="utf-8">
        <meta http-equiv="X-UA-Compatible" content="IE=edge">
        <meta content="width=device-width, initial-scale=1" name="viewport">
        <meta name="csrf-token" content="{{ csrf_token() }}">
        <meta name="robots" content="noindex">

        {{-- Blade -> JS bootstrap handoff. Identical contract to the V1 wrapper;
             the *-bound view composers populate these variables on every view. --}}
        @if(!is_null(Auth::user()))
            <script>window.PterodactylUser = {{ Illuminate\Support\Js::from(Auth::user()->toReactObject()) }};</script>
        @endif
        @if(!empty($siteConfiguration))
            <script>window.SiteConfiguration = {{ Illuminate\Support\Js::from($siteConfiguration) }};</script>
        @endif
        @if(!empty($everestConfiguration))
            <script>window.EverestConfiguration = {{ Illuminate\Support\Js::from($everestConfiguration) }};</script>
        @endif
        @if(!empty($landingConfiguration))
            <script>window.LandingConfiguration = {{ Illuminate\Support\Js::from($landingConfiguration) }};</script>
        @endif
        @if(!empty($themeConfiguration))
            <script>window.ThemeConfiguration = {{ Illuminate\Support\Js::from($themeConfiguration) }};</script>
        @endif
        @php
            $flashMessages = [];
            foreach (['success', 'error', 'info', 'warning'] as $type) {
                if (session()->has($type)) {
                    $flashMessages[] = ['type' => $type, 'message' => session($type)];
                }
            }
        @endphp
        @if(!empty($flashMessages))
            <script>window.FlashMessages = {{ Illuminate\Support\Js::from($flashMessages) }};</script>
        @endif

        @if(!empty($siteConfiguration['captcha']['enabled']) && !empty($siteConfiguration['captcha']['siteKey']))
            <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
        @endif

        @php
            $v2 = \Illuminate\Support\Facades\Vite::useHotFile(public_path('hot'))->useBuildDirectory('build');
            $entryPoint = Auth::check() ? 'src/main.tsx' : 'src/public.tsx';
            $serverFontEntries = request()->is('server/*') ? [
                '../node_modules/.pnpm/@fontsource+ibm-plex-sans@5.3.0/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2',
                '../node_modules/.pnpm/@fontsource+ibm-plex-mono@5.3.0/node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
            ] : [];
        @endphp
        @foreach($serverFontEntries as $serverFontEntry)
            <link rel="preload" as="font" type="font/woff2" crossorigin="anonymous" data-server-font-preload href="{{ $v2->asset($serverFontEntry) }}">
        @endforeach
        {!! $v2->reactRefresh() !!}
        {!! $v2([$entryPoint]) !!}
        @php
            $frontendLocale = app()->getLocale();
            if (!in_array($frontendLocale, config('app.locales', ['en']), true)) {
                $frontendLocale = config('app.fallback_locale', 'en');
            }
            $localeEntry = Auth::check()
                ? "virtual:m12-i18n-catalog/full/{$frontendLocale}"
                : "virtual:m12-i18n-catalog/public/{$frontendLocale}";
            $initialRouteEntry = match (true) {
                request()->is('auth/login') => 'src/pages/auth/LoginPage.tsx',
                request()->is('auth/login/checkpoint') => 'src/pages/auth/CheckpointPage.tsx',
                request()->is('auth/register') => 'src/pages/auth/RegisterPage.tsx',
                request()->is('auth/password') => 'src/pages/auth/ForgotPasswordPage.tsx',
                request()->is('auth/password/reset/*') => 'src/pages/auth/ResetPasswordPage.tsx',
                request()->is('auth/sso/link-choice') => 'src/pages/auth/SsoLinkChoicePage.tsx',
                request()->is('auth/sso/register') => 'src/pages/auth/SsoRegisterPage.tsx',
                Auth::check() && request()->is('/') => 'src/pages/dashboard/DashboardPage.tsx',
                Auth::check() && request()->is('tickets') => 'src/pages/account/tickets/TicketsPage.tsx',
                Auth::check() && request()->is('tickets/*') => 'src/pages/account/tickets/TicketDetailPage.tsx',
                Auth::check() && request()->is('billing/order') => 'src/pages/account/billing/store/StorePage.tsx',
                Auth::check() && request()->is('billing/orders') => 'src/pages/account/billing/orders/OrdersPage.tsx',
                Auth::check() && request()->is('activity') => 'src/pages/account/activity/ActivityPage.tsx',
                Auth::check() && request()->is('credentials') => 'src/pages/account/credentials/CredentialsPage.tsx',
                Auth::check() && request()->is('settings') => 'src/pages/account/settings/AccountPage.tsx',
                Auth::check() && request()->is('checkout/configure/*') => 'src/pages/account/billing/order/ConfigureCheckout.tsx',
                Auth::check() && request()->is('checkout/payment') => 'src/pages/account/billing/payment/PaymentPage.tsx',
                Auth::check() && request()->is('billing/processing') => 'src/pages/account/billing/payment/ProcessingPage.tsx',
                Auth::check() && request()->is('billing/success') => 'src/pages/account/billing/payment/SuccessPage.tsx',
                Auth::check() && request()->is('billing/cancel') => 'src/pages/account/billing/payment/CancelPage.tsx',
                default => null,
            };

            $initialAdminSectionEntry = match (true) {
                request()->is('admin/billing', 'admin/billing/*') => 'src/pages/admin/billing/BillingSection.tsx',
                request()->is('admin/infrastructure', 'admin/infrastructure/*') => 'src/pages/admin/infrastructure/InfrastructureSection.tsx',
                request()->is('admin/nests', 'admin/nests/*') => 'src/pages/admin/nests/NestsSection.tsx',
                request()->is('admin/ai', 'admin/ai/*') => 'src/pages/admin/ai/AiSection.tsx',
                request()->is('admin/email', 'admin/email/*') => 'src/pages/admin/email/EmailSection.tsx',
                request()->is('admin/marketplace', 'admin/marketplace/*') => 'src/pages/admin/marketplace/MarketplaceSection.tsx',
                default => null,
            };
            $initialAdminPageEntry = match (true) {
                request()->is('admin/billing') => 'src/pages/admin/billing/BillingOverviewPage.tsx',
                request()->is('admin/billing/products/categories/*') => 'src/pages/admin/billing/products/CategoryDetailPage.tsx',
                request()->is('admin/billing/products/new', 'admin/billing/products/*') => 'src/pages/admin/billing/products/ProductEditorPage.tsx',
                request()->is('admin/billing/products') => 'src/pages/admin/billing/products/ProductsPage.tsx',
                request()->is('admin/billing/store') => 'src/pages/admin/billing/store/StoreEditor.tsx',
                request()->is('admin/billing/orders') => 'src/pages/admin/billing/orders/OrdersPage.tsx',
                request()->is('admin/billing/invoices') => 'src/pages/admin/billing/invoices/InvoicesPage.tsx',
                request()->is('admin/billing/coupons') => 'src/pages/admin/billing/coupons/CouponsPage.tsx',
                request()->is('admin/billing/exceptions') => 'src/pages/admin/billing/exceptions/ExceptionsPage.tsx',
                request()->is('admin/billing/settings', 'admin/billing/settings/*') => 'src/pages/admin/billing/settings/SettingsPage.tsx',
                request()->is('admin/billing/invoice-settings') => 'src/pages/admin/billing/invoicesettings/InvoiceSettingsPage.tsx',
                request()->is('admin/infrastructure') => 'src/pages/admin/infrastructure/InfrastructureOverviewPage.tsx',
                request()->is('admin/infrastructure/nodes/new', 'admin/infrastructure/nodes/*/edit') => 'src/pages/admin/infrastructure/NodeEditorPage.tsx',
                request()->is('admin/infrastructure/nodes/*') => 'src/pages/admin/nodes/NodeDetailPage.tsx',
                request()->is('admin/infrastructure/servers/new') => 'src/pages/admin/infrastructure/ServerEditorPage.tsx',
                request()->is('admin/infrastructure/servers/*') => 'src/pages/admin/infrastructure/server/ServerDetailPage.tsx',
                request()->is('admin/nests/*/eggs/new', 'admin/nests/*/eggs/*') => 'src/pages/admin/nests/egg/EggEditorPage.tsx',
                request()->is('admin/nests', 'admin/nests/*') => 'src/pages/admin/nests/NestsWorkspace.tsx',
                request()->is('admin/ai') => 'src/pages/admin/ai/pages/OverviewPage.tsx',
                request()->is('admin/ai/provider') => 'src/pages/admin/ai/pages/ProviderPage.tsx',
                request()->is('admin/ai/generation') => 'src/pages/admin/ai/pages/GenerationPage.tsx',
                request()->is('admin/ai/agent') => 'src/pages/admin/ai/pages/AgentPage.tsx',
                request()->is('admin/ai/tools') => 'src/pages/admin/ai/pages/ToolsPage.tsx',
                request()->is('admin/ai/privacy') => 'src/pages/admin/ai/pages/PrivacyPage.tsx',
                request()->is('admin/ai/performance') => 'src/pages/admin/ai/pages/PerformancePage.tsx',
                request()->is('admin/ai/limits') => 'src/pages/admin/ai/pages/LimitsPage.tsx',
                request()->is('admin/ai/logs') => 'src/pages/admin/ai/pages/LogsPage.tsx',
                request()->is('admin/email') => 'src/pages/admin/email/pages/OverviewPage.tsx',
                request()->is('admin/email/smtp') => 'src/pages/admin/email/pages/SmtpPage.tsx',
                request()->is('admin/email/resend') => 'src/pages/admin/email/pages/ResendPage.tsx',
                request()->is('admin/email/testing') => 'src/pages/admin/email/pages/TestingPage.tsx',
                request()->is('admin/email/notifications') => 'src/pages/admin/email/pages/NotificationsPage.tsx',
                request()->is('admin/email/activity') => 'src/pages/admin/email/pages/ActivityPage.tsx',
                request()->is('admin/email/templates') => 'src/pages/admin/email/pages/TemplatesPage.tsx',
                request()->is('admin/marketplace') => 'src/pages/admin/marketplace/pages/OverviewPage.tsx',
                request()->is('admin/marketplace/settings') => 'src/pages/admin/marketplace/pages/SettingsPage.tsx',
                request()->is('admin/marketplace/providers') => 'src/pages/admin/marketplace/pages/ProvidersPage.tsx',
                default => null,
            };
            $initialAdminTabEntry = match (true) {
                request()->is('admin/billing/settings') => 'src/pages/admin/billing/settings/GeneralTab.tsx',
                request()->is('admin/billing/settings/pricing') => 'src/pages/admin/billing/settings/PricingTab.tsx',
                request()->is('admin/billing/settings/payments') => 'src/pages/admin/billing/settings/PaymentsTab.tsx',
                request()->is('admin/billing/settings/advanced') => 'src/pages/admin/billing/settings/AdvancedTab.tsx',
                default => null,
            };
            $initialServerSectionEntry = match (true) {
                request()->is('server/*/files', 'server/*/files/*') => 'src/pages/server/files/FilesSection.tsx',
                request()->is('server/*/marketplace', 'server/*/marketplace/*') => 'src/pages/server/marketplace/MarketplaceSection.tsx',
                request()->is('server/*/schedules', 'server/*/schedules/*') => 'src/pages/server/schedules/SchedulesSection.tsx',
                default => null,
            };
            $initialServerPageEntry = match (true) {
                request()->is('server/*/files/new', 'server/*/files/edit/*') => 'src/pages/server/files/components/FileEditor.tsx',
                request()->is('server/*/files') => 'src/pages/server/files/components/FileBrowser.tsx',
                request()->is('server/*/schedules/*') => 'src/pages/server/schedules/ScheduleDetailPage.tsx',
                request()->is('server/*/schedules') => 'src/pages/server/schedules/SchedulesListPage.tsx',
                default => null,
            };
            $initialRouteEntries = array_values(array_unique(array_filter([
                $initialRouteEntry,
                $initialAdminSectionEntry,
                $initialAdminPageEntry,
                $initialAdminTabEntry,
                $initialServerSectionEntry,
                $initialServerPageEntry,
            ])));

            $initialLayoutEntry = match (true) {
                request()->is('auth/*') => 'src/layouts/AuthLayout.tsx',
                request()->is('server/*') => 'src/layouts/ServerLayout.tsx',
                request()->is('admin', 'admin/*') => 'src/layouts/AdminLayout.tsx',
                Auth::check() => 'src/layouts/DashboardLayout.tsx',
                default => null,
            };
        @endphp
        <link rel="modulepreload" as="script" data-locale-preload href="{{ $v2->asset($localeEntry) }}">
        @if($initialLayoutEntry)
            <link rel="modulepreload" as="script" data-layout-preload href="{{ $v2->asset($initialLayoutEntry) }}">
        @endif
        @foreach($initialRouteEntries as $initialRouteEntry)
            <link rel="modulepreload" as="script" data-route-preload href="{{ $v2->asset($initialRouteEntry) }}">
        @endforeach
    </head>
    <body>
        <div id="app">@include('templates.v2.skeleton')</div>
    </body>
</html>
