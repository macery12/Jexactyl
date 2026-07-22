<?php

use Illuminate\Support\Facades\Route;
use Everest\Http\Controllers\Api\ApiDocsController;

Route::get('/openapi.json', [ApiDocsController::class, 'json'])->name('api.docs.openapi');
Route::get('/docs', [ApiDocsController::class, 'docs'])->name('api.docs.ui');
