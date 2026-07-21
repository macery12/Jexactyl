<?php

namespace Everest\Http\Controllers\Api\Client\Servers;

use Everest\Exceptions\DisplayException;
use Everest\Models\Server;
use Carbon\CarbonImmutable;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Everest\Services\Nodes\NodeJWTService;
use Everest\Services\Files\FileDiffService;
use Everest\Repositories\Wings\DaemonFileRepository;
use Everest\Transformers\Api\Client\FileObjectTransformer;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Everest\Http\Requests\Api\Client\Servers\Files\CopyFileRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\PullFileRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\ListFilesRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\ChmodFilesRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\DeleteFileRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\RenameFileRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\CreateFolderRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\CompressFilesRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\DecompressFilesRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\GetFileContentsRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\WriteFileContentRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\WriteFileWithDiffRequest;

class FileController extends ClientApiController
{
    private function isArchivePathSegment(string $segment): bool
    {
        $lower = strtolower($segment);

        foreach ([
            '.zip',
            '.7z',
            '.ddup',
            '.tar',
            '.tar.gz',
            '.tgz',
            '.tar.xz',
            '.txz',
            '.tar.zst',
            '.tzst',
            '.tar.lz4',
            '.tlz4',
            '.tar.bz2',
            '.tbz2',
            '.gz',
            '.xz',
            '.zst',
            '.lz4',
            '.bz2',
        ] as $extension) {
            if (str_ends_with($lower, $extension)) {
                return true;
            }
        }

        return false;
    }

    private function isArchiveReadOnlyPath(string $path): bool
    {
        $segments = array_values(array_filter(explode('/', str_replace('\\\\', '/', trim($path))), fn (string $segment) => $segment !== ''));

        if (count($segments) === 0) {
            return false;
        }

        foreach ($segments as $segment) {
            if ($this->isArchivePathSegment($segment)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @throws \Everest\Exceptions\DisplayException
     */
    private function guardArchiveWritePath(string $path): void
    {
        if ($this->isArchiveReadOnlyPath($path)) {
            throw new DisplayException('You cannot write to a file inside an archive. Extract it first.');
        }
    }

    /**
     * FileController constructor.
     */
    public function __construct(
        private NodeJWTService $jwtService,
        private DaemonFileRepository $fileRepository,
        private FileDiffService $diffService
    ) {
        parent::__construct();
    }

    /**
     * Returns a listing of files in a given directory.
     *
     * @throws \Everest\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function directory(ListFilesRequest $request, Server $server): array
    {
        $contents = $this->fileRepository
            ->setServer($server)
            ->getDirectory($request->get('directory') ?? '/');

        return $this->fractal->collection($contents)
            ->transformWith(FileObjectTransformer::class)
            ->toArray();
    }

    /**
     * Return the contents of a specified file for the user.
     *
     * @throws \Throwable
     */
    public function contents(GetFileContentsRequest $request, Server $server): Response
    {
        $response = $this->fileRepository->setServer($server)->getContent(
            $request->get('file'),
            config('everest.files.max_edit_size')
        );

        Activity::event('server:file.read')->property('file', $request->get('file'))->log();

        return new Response($response, Response::HTTP_OK, ['Content-Type' => 'text/plain']);
    }

    /**
     * Generates a one-time token with a link that the user can use to
     * download a given file.
     *
     * @throws \Throwable
     */
    public function download(GetFileContentsRequest $request, Server $server): array
    {
        $token = $this->jwtService
            ->setExpiresAt(CarbonImmutable::now()->addMinutes(15))
            ->setScope(NodeJWTService::SCOPE_FILE_DOWNLOAD)
            ->setUser($request->user())
            ->setClaims([
                'file_path' => rawurldecode($request->get('file')),
                'server_uuid' => $server->uuid,
            ])
            ->handle($server->node, $request->user()->id . $server->uuid);

        Activity::event('server:file.download')->property('file', $request->get('file'))->log();

        return [
            'object' => 'signed_url',
            'attributes' => [
                'url' => sprintf(
                    '%s/download/file?token=%s',
                    $server->node->getConnectionAddress(),
                    $token->toString()
                ),
            ],
        ];
    }

    /**
     * Writes the contents of the specified file to the server.
     *
     * @throws \Everest\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function write(WriteFileContentRequest $request, Server $server): JsonResponse
    {
        $this->guardArchiveWritePath($request->get('file'));

        $this->fileRepository->setServer($server)->putContent($request->get('file'), $request->getContent());

        Activity::event('server:file.write')->property('file', $request->get('file'))->log();

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Writes the contents of the specified file to the server with diff tracking.
     * This endpoint accepts JSON with original and new content to calculate diffs.
     *
     * @throws \Everest\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function writeWithDiff(WriteFileWithDiffRequest $request, Server $server): JsonResponse
    {
        $file = $request->input('file');
        $content = $request->input('content');
        $originalContent = $request->input('original_content', '');

        $this->guardArchiveWritePath($file);

        // Write the new content to the file
        $this->fileRepository->setServer($server)->putContent($file, $content);

        // Build activity log with diff information if it's a text file
        $activity = Activity::event('server:file.write')->property('file', $file);

        if ($this->diffService->isTextFile($file) && $originalContent !== null) {
            $diff = $this->diffService->calculateDiff($originalContent, $content, $file);

            $activity->property('diff', [
                'additions' => $diff['additions'],
                'deletions' => $diff['deletions'],
                'hunks' => $diff['hunks'],
                'is_new_file' => $diff['is_new_file'] ?? false,
                'large_file' => $diff['large_file'] ?? false,
            ]);
        }

        $activity->log();

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Creates a new folder on the server.
     *
     * @throws \Throwable
     */
    public function create(CreateFolderRequest $request, Server $server): JsonResponse
    {
        $this->fileRepository
            ->setServer($server)
            ->createDirectory($request->input('name'), $request->input('root', '/'));

        Activity::event('server:file.create-directory')
            ->property('name', $request->input('name'))
            ->property('directory', $request->input('root'))
            ->log();

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Renames a file on the remote machine.
     *
     * @throws \Throwable
     */
    public function rename(RenameFileRequest $request, Server $server): JsonResponse
    {
        $this->fileRepository
            ->setServer($server)
            ->renameFiles($request->input('root'), $request->input('files'));

        Activity::event('server:file.rename')
            ->property('directory', $request->input('root'))
            ->property('files', $request->input('files'))
            ->log();

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Copies a file on the server.
     *
     * @throws \Everest\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function copy(CopyFileRequest $request, Server $server): JsonResponse
    {
        $this->fileRepository
            ->setServer($server)
            ->copyFile($request->input('location'));

        Activity::event('server:file.copy')->property('file', $request->input('location'))->log();

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * @throws \Everest\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function compress(CompressFilesRequest $request, Server $server): array
    {
        $file = $this->fileRepository->setServer($server)->compressFiles(
            $request->input('root'),
            $request->input('files')
        );

        Activity::event('server:file.compress')
            ->property('directory', $request->input('root'))
            ->property('files', $request->input('files'))
            ->log();

        return $this->fractal->item($file)
            ->transformWith(FileObjectTransformer::class)
            ->toArray();
    }

    /**
     * @throws \Everest\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function decompress(DecompressFilesRequest $request, Server $server): JsonResponse
    {
        set_time_limit(300);

        $this->fileRepository->setServer($server)->decompressFile(
            $request->input('root'),
            $request->input('file')
        );

        Activity::event('server:file.decompress')
            ->property('directory', $request->input('root'))
            ->property('files', $request->input('file'))
            ->log();

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }

    /**
     * Deletes files or folders for the server in the given root directory.
     *
     * @throws \Everest\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function delete(DeleteFileRequest $request, Server $server): JsonResponse
    {
        $this->fileRepository->setServer($server)->deleteFiles(
            $request->input('root'),
            $request->input('files')
        );

        Activity::event('server:file.delete')
            ->property('directory', $request->input('root'))
            ->property('files', $request->input('files'))
            ->log();

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Updates file permissions for file(s) in the given root directory.
     *
     * @throws \Everest\Exceptions\Http\Connection\DaemonConnectionException
     */
    public function chmod(ChmodFilesRequest $request, Server $server): JsonResponse
    {
        $this->fileRepository->setServer($server)->chmodFiles(
            $request->input('root'),
            $request->input('files')
        );

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Requests that a file be downloaded from a remote location by Wings.
     *
     * @throws \Throwable
     */
    public function pull(PullFileRequest $request, Server $server): JsonResponse
    {
        $this->fileRepository->setServer($server)->pull(
            $request->input('url'),
            $request->input('directory'),
            $request->safe(['filename', 'use_header', 'foreground'])
        );

        Activity::event('server:file.pull')
            ->property('directory', $request->input('directory'))
            ->property('url', $request->input('url'))
            ->log();

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }
}
