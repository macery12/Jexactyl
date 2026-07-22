<?php

namespace Everest\Tests\Unit\Http\Controllers\Api\Application\Billing;

use Everest\Tests\TestCase;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Everest\Models\Billing\Category;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Http\Controllers\Api\Application\Billing\CategoryController;
use Everest\Http\Requests\Api\Application\Billing\Categories\UpdateBillingCategoryRequest;

class CategoryControllerTest extends TestCase
{
    public function setUp(): void
    {
        parent::setUp();

        $dbPath = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'category_controller_test.sqlite';

        config()->set('database.default', 'sqlite');
        config()->set('database.connections.sqlite.database', $dbPath);

        if (!file_exists($dbPath)) {
            touch($dbPath);
        }

        Schema::dropIfExists('eggs');
        Schema::create('eggs', function (Blueprint $table) {
            $table->increments('id');
            $table->unsignedInteger('nest_id');
        });

        DB::table('eggs')->insert(['id' => 5, 'nest_id' => 2]);
        DB::table('eggs')->insert(['id' => 6, 'nest_id' => 3]);
    }

    public function tearDown(): void
    {
        \Mockery::close();
        parent::tearDown();
    }

    public function testUpdatePrunesStaleAllowedEggs()
    {
        $controller = $this->app->make(CategoryController::class);

        $request = \Mockery::mock(UpdateBillingCategoryRequest::class);
        $request->shouldReceive('input')->with('eggId')->andReturn(5);
        $request->shouldReceive('input')->with('allowedEggs', [5])->andReturn([999]);
        $request->shouldReceive('input')->with('name')->andReturn('Example');
        $request->shouldReceive('input')->with('icon')->andReturn(null);
        $request->shouldReceive('input')->with('description')->andReturn(null);
        $request->shouldReceive('input')->with('visible')->andReturn(true);
        $request->shouldReceive('input')->with('allowEggChanges', true)->andReturn(true);
        $request->shouldReceive('input')->with('allowPlanChanges', true)->andReturn(true);
        $request->shouldReceive('all')->andReturn(['allowedEggs' => [999]]);

        $category = \Mockery::mock(Category::class);
        $category->shouldReceive('updateOrFail')
            ->once()
            ->with(\Mockery::on(function (array $data) {
                $this->assertSame([5], $data['allowed_eggs']);

                return true;
            }))
            ->andReturnTrue();

        Activity::shouldReceive('event')->once()->with('admin:billing:categories:update')->andReturnSelf();
        Activity::shouldReceive('property')->andReturnSelf();
        Activity::shouldReceive('description')->andReturnSelf();
        Activity::shouldReceive('log')->andReturnNull();

        $response = $controller->update($request, $category);

        $this->assertInstanceOf(Response::class, $response);
        $this->assertSame(Response::HTTP_NO_CONTENT, $response->getStatusCode());
    }

    public function testUpdatePrunesEggsFromOtherNests()
    {
        $controller = $this->app->make(CategoryController::class);

        $request = \Mockery::mock(UpdateBillingCategoryRequest::class);
        $request->shouldReceive('input')->with('eggId')->andReturn(5);
        $request->shouldReceive('input')->with('allowedEggs', [5])->andReturn([5, 6]);
        $request->shouldReceive('input')->with('name')->andReturn('Example');
        $request->shouldReceive('input')->with('icon')->andReturn(null);
        $request->shouldReceive('input')->with('description')->andReturn(null);
        $request->shouldReceive('input')->with('visible')->andReturn(true);
        $request->shouldReceive('input')->with('allowEggChanges', true)->andReturn(true);
        $request->shouldReceive('input')->with('allowPlanChanges', true)->andReturn(true);
        $request->shouldReceive('all')->andReturn(['allowedEggs' => [6]]);

        $category = \Mockery::mock(Category::class);
        $category->shouldReceive('updateOrFail')
            ->once()
            ->with(\Mockery::on(function (array $data) {
                $this->assertSame([5], $data['allowed_eggs']);

                return true;
            }))
            ->andReturnTrue();

        Activity::shouldReceive('event')->once()->with('admin:billing:categories:update')->andReturnSelf();
        Activity::shouldReceive('property')->andReturnSelf();
        Activity::shouldReceive('description')->andReturnSelf();
        Activity::shouldReceive('log')->andReturnNull();

        $response = $controller->update($request, $category);

        $this->assertInstanceOf(Response::class, $response);
        $this->assertSame(Response::HTTP_NO_CONTENT, $response->getStatusCode());
    }
}
