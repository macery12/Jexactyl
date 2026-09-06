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
        @endphp
        {!! $v2->reactRefresh() !!}
        {!! $v2(['src/main.tsx']) !!}
    </head>
    <body>
        <div id="app">@include('templates.v2.skeleton')</div>
    </body>
</html>
