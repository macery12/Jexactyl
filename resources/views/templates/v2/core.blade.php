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
            <script>window.PterodactylUser = {!! json_encode(Auth::user()->toReactObject()) !!};</script>
        @endif
        @if(!empty($siteConfiguration))
            <script>window.SiteConfiguration = {!! json_encode($siteConfiguration) !!};</script>
        @endif
        @if(!empty($everestConfiguration))
            <script>window.EverestConfiguration = {!! json_encode($everestConfiguration) !!};</script>
        @endif
        @if(!empty($landingConfiguration))
            <script>window.LandingConfiguration = {!! json_encode($landingConfiguration) !!};</script>
        @endif
        @if(!empty($themeConfiguration))
            <script>window.ThemeConfiguration = {!! json_encode($themeConfiguration) !!};</script>
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
            <script>window.FlashMessages = {!! json_encode($flashMessages) !!};</script>
        @endif

        @if(!empty($siteConfiguration['captcha']['enabled']) && !empty($siteConfiguration['captcha']['siteKey']))
            <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
        @endif

        @php
            $v2 = \Illuminate\Support\Facades\Vite::useHotFile(public_path('hot-v2'))->useBuildDirectory('build-v2');
        @endphp
        {!! $v2->reactRefresh() !!}
        {!! $v2(['src/main.tsx']) !!}
    </head>
    <body>
        <div id="app"></div>
    </body>
</html>
