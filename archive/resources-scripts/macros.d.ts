import { ComponentType, ReactElement } from 'react';

import styledImport, { css as cssImport, CSSProp, StyledComponentProps } from 'styled-components';

declare module 'react' {
    interface Attributes {
        css?: CSSProp;
    }
}

declare module 'styled-components' {
    interface StyledComponentBase<
        C extends string | ComponentType<any>,
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        T extends object,
        // eslint-disable-next-line @typescript-eslint/no-empty-object-type
        O extends object = {},
        A extends keyof any = never,
    > extends ForwardRefExoticBase<StyledComponentProps<C, T, O, A>> {
        (
            props: StyledComponentProps<C, T, O, A> & { as?: Element | string; forwardedAs?: never | undefined },
        ): ReactElement<StyledComponentProps<C, T, O, A>>;
    }
}

declare module 'twin.macro' {
    const css: typeof cssImport;
    const styled: typeof styledImport;
}
