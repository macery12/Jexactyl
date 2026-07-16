import http from '@/api/http';

export interface BillingImportConflictIssue {
    field: 'nest_id' | 'egg_id' | 'allowed_eggs';
    code: 'invalid_nest' | 'invalid_default_egg' | 'invalid_allowed_eggs';
    message: string;
    invalid_value?: number | null;
    invalid_values?: number[];
}

export interface BillingImportDependentProduct {
    uuid: string;
    name: string;
}

export interface BillingImportConflict {
    category_key: string;
    category_uuid: string;
    category_name: string;
    current: {
        nest_id: number | null;
        egg_id: number | null;
        allowed_eggs: number[];
    };
    issues: BillingImportConflictIssue[];
    dependent_products: BillingImportDependentProduct[];
}

export interface BillingImportNestOption {
    id: number;
    name: string;
}

export interface BillingImportConflictResponse {
    object: 'billing_import_conflict';
    attributes: {
        conflicts: BillingImportConflict[];
        available_nests: BillingImportNestOption[];
    };
}

export interface BillingImportResolution {
    categories: Record<
        string,
        {
            nest_id?: number;
            egg_id?: number;
            allowed_eggs?: number[];
            drop_products?: string[];
            drop_category?: boolean;
        }
    >;
}

export const importBillingConfiguration = (
    uploadedJson: object,
    override: boolean,
    ignoreDuplicates: boolean,
    resolution?: BillingImportResolution,
): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.post('/api/application/billing/config/import', {
            data: uploadedJson,
            override,
            ignore_duplicates: ignoreDuplicates,
            resolution,
        })
            .then(() => resolve())
            .catch(error => reject(error));
    });
};

export const exportBillingConfiguration = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/application/billing/config/export`, { responseType: 'blob' })
            .then(({ data }) => {
                const jsonBlob = new Blob([JSON.stringify(data, null, 2)], {
                    type: 'application/json',
                });

                const url = window.URL.createObjectURL(jsonBlob);

                const link = document.createElement('a');
                link.href = url;
                link.download = 'data.json';
                link.click();

                window.URL.revokeObjectURL(url);

                resolve();
            })
            .catch(reject);
    });
};
