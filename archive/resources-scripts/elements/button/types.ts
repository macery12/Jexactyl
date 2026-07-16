import { ElementType } from 'react';

export enum Shape {
    Default,
    IconSquare,
}

export enum Size {
    Default,
    Small,
    Large,
}

export enum Variant {
    Primary,
    Secondary,
}

export const Options = { Shape, Size, Variant };

export type ButtonProps = JSX.IntrinsicElements['button'] & {
    shape?: Shape;
    size?: Size | 'sm' | 'small' | 'large' | 'lg' | 'default';
    loading?: boolean;
    variant?: Variant | 'primary' | 'secondary' | 'filled' | 'outlined' | 'text' | 'danger';
    icon?: ElementType;
};
