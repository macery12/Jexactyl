/// <reference types="vite/client" />

declare module 'virtual:m12-i18n-catalog/*' {
    const catalog: Record<string, (inputs?: Record<string, unknown>) => string>;
    export default catalog;
}
