/// <reference types="vite/client" />

declare module 'virtual:m12-i18n-catalog/*' {
    type MessageFunction = (inputs?: Record<string, unknown>) => string;
    const catalog: Record<string, MessageFunction>;
    export default catalog;
}
