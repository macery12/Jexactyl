<?php

namespace Everest\Http\Controllers\Api;

use Illuminate\View\View;
use Illuminate\Http\Request;
use Dedoc\Scramble\Generator;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Everest\Http\Controllers\Controller;

class ApiDocsController extends Controller
{
    public function json(Request $request, Generator $generator): JsonResponse
    {
        $cacheEnabled = config('api-docs.cache.enabled', true);
        $cacheStore = config('api-docs.cache.store');
        $cacheTtl = (int) config('api-docs.cache.ttl', 3600);
        $cacheKey = 'api_docs.openapi';

        $cache = $cacheStore ? Cache::store($cacheStore) : Cache::store();

        if ($request->boolean('refresh')) {
            $cache->forget($cacheKey);
        }

        $spec = $cacheEnabled
            ? $cache->remember($cacheKey, $cacheTtl, fn () => $generator())
            : $generator();

        return response()->json($spec);
    }

    public function docs(): View
    {
        return view('scramble::docs');
    }
}
