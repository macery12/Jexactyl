<?php

use Everest\Http\Controllers\Base;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Admin — V2 shell
|--------------------------------------------------------------------------
|
| Serves the V2 shell for the whole /admin URL space. Unlike the site root,
| this group keeps V1's server-side gates (auth.session + 2FA +
| AdminAuthenticate — see RouteServiceProvider): a guest or non-admin never
| receives the admin shell, exactly as with V1.
*/

// V1 marketplace aliases — V2 has one canonical path.
Route::permanentRedirect('/plugins/{any?}', '/admin/marketplace')->where('any', '.*');
Route::permanentRedirect('/mods/{any?}', '/admin/marketplace')->where('any', '.*');

Route::get('/', [Base\IndexController::class, 'v2'])->name('admin.index')->fallback();
Route::get('/{react}', [Base\IndexController::class, 'v2'])->where('react', '.+');
