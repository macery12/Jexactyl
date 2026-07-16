import { forwardRef } from 'react';
import classNames from 'classnames';

import type { ButtonProps } from '@/elements/button/types';
import { Options } from '@/elements/button/types';
import styles from './style.module.css';
import { useStoreState } from '@/state/hooks';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSpinner } from '@fortawesome/free-solid-svg-icons';

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ children, shape, size, variant, className, loading, icon: Icon, ...rest }, ref) => {
        return (
            <button
                ref={ref}
                className={classNames(
                    styles.button,
                    {
                        [styles.secondary]: variant === Options.Variant.Secondary || variant === 'secondary',
                        [styles.square]: shape === Options.Shape.IconSquare,
                        [styles.small]: size === Options.Size.Small || size === 'small' || size === 'sm',
                        [styles.large]: size === Options.Size.Large || size === 'large' || size === 'lg',
                    },
                    className,
                    loading && 'text-gray-300',
                )}
                {...rest}
            >
                {children}
                {Icon && <Icon className={'ml-1 mt-1 h-4 w-4'} />}
                {loading && <FontAwesomeIcon icon={faSpinner} className={'mt-1 ml-2 h-3 w-3 animate-spin'} />}
            </button>
        );
    },
);

const StandardButton = forwardRef<HTMLButtonElement, ButtonProps>(({ className, ...props }, ref) => {
    const { primary } = useStoreState(state => state.theme.data!.colors);

    return (
        // @ts-expect-error not sure how to get this correct
        <Button ref={ref} className={className} style={{ backgroundColor: primary }} {...props} />
    );
});

const TextButton = forwardRef<HTMLButtonElement, ButtonProps>(({ className, ...props }, ref) => (
    // @ts-expect-error not sure how to get this correct
    <Button ref={ref} className={classNames(styles.text, className)} {...props} />
));

const DangerButton = forwardRef<HTMLButtonElement, ButtonProps>(({ className, ...props }, ref) => (
    // @ts-expect-error not sure how to get this correct
    <Button ref={ref} className={classNames(styles.danger, className)} {...props} />
));

const InfoButton = forwardRef<HTMLButtonElement, ButtonProps>(({ className, ...props }, ref) => (
    // @ts-expect-error not sure how to get this correct
    <Button ref={ref} className={classNames(styles.info, className)} {...props} />
));

const WarnButton = forwardRef<HTMLButtonElement, ButtonProps>(({ className, ...props }, ref) => (
    // @ts-expect-error not sure how to get this correct
    <Button ref={ref} className={classNames(styles.warn, className)} {...props} />
));

const SuccessButton = forwardRef<HTMLButtonElement, ButtonProps>(({ className, ...props }, ref) => (
    // @ts-expect-error not sure how to get this correct
    <Button ref={ref} className={classNames(styles.success, className)} {...props} />
));

const DarkButton = forwardRef<HTMLButtonElement, ButtonProps>(({ className, ...props }, ref) => (
    // @ts-expect-error not sure how to get this correct
    <Button ref={ref} className={classNames(styles.dark, className)} {...props} />
));

const _Button = Object.assign(StandardButton, {
    Sizes: Options.Size,
    Shapes: Options.Shape,
    Variants: Options.Variant,
    Text: TextButton,
    Danger: DangerButton,
    Info: InfoButton,
    Warn: WarnButton,
    Success: SuccessButton,
    Dark: DarkButton,
});

export default _Button;
