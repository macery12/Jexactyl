<?php

use Illuminate\Support\Facades\Route;
use Everest\Http\Controllers\Api\Pub\PublicStorefrontController;

/*
|--------------------------------------------------------------------------
| Public API (no authentication)
|--------------------------------------------------------------------------
|
| Endpoint: /api/storefront
|
| Read-only, IP rate-limited data safe to expose to logged-out visitors on
| the landing page. Registered outside the Sanctum `api` group.
|
*/

Route::prefix('/storefront')->middleware(['throttle:storefront.read'])->group(function () {
    Route::get('/catalog', [PublicStorefrontController::class, 'catalog']);
});
