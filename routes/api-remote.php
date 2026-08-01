<?php

use Illuminate\Support\Facades\Route;
use Everest\Http\Controllers\Api\Remote;
use Everest\Http\Middleware\Api\Daemon\DaemonBackupAuthorization;

// Routes for the Wings daemon.
Route::post('/sftp/auth', Remote\SftpAuthenticationController::class);

Route::get('/servers', [Remote\Servers\ServerDetailsController::class, 'list']);
Route::post('/servers/reset', [Remote\Servers\ServerDetailsController::class, 'resetState']);
Route::post('/activity', Remote\ActivityProcessingController::class)
    ->middleware('throttle:daemon.activity');

Route::group(['prefix' => '/servers/{uuid}'], function () {
    Route::get('/', Remote\Servers\ServerDetailsController::class);
    Route::get('/install', [Remote\Servers\ServerInstallController::class, 'index']);
    Route::post('/install', [Remote\Servers\ServerInstallController::class, 'store']);

    Route::post('/transfer/failure', [Remote\Servers\ServerTransferController::class, 'failure']);
    Route::post('/transfer/success', [Remote\Servers\ServerTransferController::class, 'success']);
});

Route::group(['prefix' => '/backups', 'middleware' => DaemonBackupAuthorization::class], function () {
    Route::get('/{backup}', Remote\Backups\BackupRemoteUploadController::class);
    Route::post('/{backup}', [Remote\Backups\BackupStatusController::class, 'index']);
    Route::post('/{backup}/restore', [Remote\Backups\BackupStatusController::class, 'restore']);
});
