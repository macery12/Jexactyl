<?php

namespace Everest\Http\Controllers\Base;

use Illuminate\View\View;
use Everest\Http\Controllers\Controller;

class IndexController extends Controller
{
    /**
     * Serves the panel UI shell. Wildcard routes mount this for the root,
     * /auth and /admin URL spaces — client-side routing is fully owned by
     * the SPA.
     */
    public function v2(): View
    {
        return view('templates/v2.core');
    }
}
