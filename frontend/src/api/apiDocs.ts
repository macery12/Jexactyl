import http from '@/lib/http';
import type { OpenApiDoc } from '@/pages/admin/apidocs/openapi';

// Reader for the auto-generated OpenAPI document (Scramble) served at
// /api/openapi.json. Admin-gated server-side by the ApiDocsAccess middleware.
// The spec is cached on the server; `refresh` busts that cache and regenerates.

export const OPENAPI_SPEC_URL = '/api/openapi.json';
export const OPENAPI_DOCS_URL = '/api/docs';

export async function getApiSpec(refresh = false): Promise<OpenApiDoc> {
    const { data } = await http.get<OpenApiDoc>(OPENAPI_SPEC_URL, {
        params: refresh ? { refresh: 1 } : undefined,
    });
    return data;
}
