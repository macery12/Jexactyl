<?php

use Everest\Http\Controllers\Base;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Site root — V2 shell
|--------------------------------------------------------------------------
|
| The SPA owns client-side routing from the root: landing page for guests,
| dashboard for authenticated users. This group carries no auth middleware —
| the landing page must render for guests, the SPA guards its authenticated
| areas, and the API enforces server-side. The /admin URL space keeps its
| server-side gates (see RouteServiceProvider).
*/

// V1 → V2 URL inversions, registered ahead of the catch-all. V1's /account
// pages moved: the dashboard is the area index at /, and the old sub-pages
// live at the root level.
Route::permanentRedirect('/account/billing/order/{id}', '/billing/orders')->where('id', '[0-9]+');
Route::permanentRedirect('/account/security', '/settings');
// V1's /account was the account overview (profile/email/password) — that
// content lives in V2's Settings, while / is now the dashboard.
Route::permanentRedirect('/account', '/settings')->name('account');
// Everything else keeps its path minus the prefix: credentials, activity,
// tickets, billing/* (V2 mounts the account area at the root).
Route::permanentRedirect('/account/{any}', '/{any}')->where('any', '.*');

Route::get('/', [Base\IndexController::class, 'v2'])->name('index')->fallback();

Route::get('/{react}', [Base\IndexController::class, 'v2'])
    ->where('react', '^(?!(\/)?(api|auth|admin|daemon)).+');
