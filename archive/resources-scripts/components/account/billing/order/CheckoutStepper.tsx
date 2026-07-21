import { useStoreState } from '@/state/hooks';
import { CheckIcon } from '@heroicons/react/solid';
import classNames from 'classnames';

interface Step {
    id: number;
    name: string;
    status: 'complete' | 'current' | 'upcoming';
}

interface Props {
    steps: Step[];
}

export default ({ steps }: Props) => {
    const { colors } = useStoreState(state => state.theme.data!);

    return (
        <nav aria-label="Progress" className="mb-8">
            <ol className="flex items-center justify-between">
                {steps.map((step, stepIdx) => (
                    <li
                        key={step.name}
                        className={classNames(
                            'relative',
                            stepIdx !== steps.length - 1 ? 'flex-1 pr-4 sm:pr-8 md:pr-20' : '',
                        )}
                    >
                        {step.status === 'complete' ? (
                            <>
                                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                    {stepIdx !== steps.length - 1 && (
                                        <div className="h-0.5 w-full" style={{ backgroundColor: colors.primary }} />
                                    )}
                                </div>
                                <div
                                    className="relative flex h-8 w-8 items-center justify-center rounded-full"
                                    style={{ backgroundColor: colors.primary }}
                                >
                                    <CheckIcon className="h-5 w-5 text-white" aria-hidden="true" />
                                    <span className="sr-only">{step.name}</span>
                                </div>
                                <span className="absolute top-10 left-1/2 -translate-x-1/2 text-center text-xs text-gray-400 max-w-[60px] sm:max-w-none sm:whitespace-nowrap">
                                    {step.name}
                                </span>
                            </>
                        ) : step.status === 'current' ? (
                            <>
                                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                    {stepIdx !== steps.length - 1 && <div className="h-0.5 w-full bg-gray-600" />}
                                </div>
                                <div
                                    className="relative flex h-8 w-8 items-center justify-center rounded-full border-2"
                                    style={{ borderColor: colors.primary, backgroundColor: colors.secondary }}
                                    aria-current="step"
                                >
                                    <span
                                        className="h-2.5 w-2.5 rounded-full"
                                        style={{ backgroundColor: colors.primary }}
                                    />
                                    <span className="sr-only">{step.name}</span>
                                </div>
                                <span
                                    className="absolute top-10 left-1/2 -translate-x-1/2 text-center text-xs font-semibold max-w-[60px] sm:max-w-none sm:whitespace-nowrap"
                                    style={{ color: colors.primary }}
                                >
                                    {step.name}
                                </span>
                            </>
                        ) : (
                            <>
                                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                    {stepIdx !== steps.length - 1 && <div className="h-0.5 w-full bg-gray-600" />}
                                </div>
                                <div
                                    className="group relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-gray-600"
                                    style={{ backgroundColor: colors.secondary }}
                                >
                                    <span className="h-2.5 w-2.5 rounded-full bg-gray-600" />
                                    <span className="sr-only">{step.name}</span>
                                </div>
                                <span className="absolute top-10 left-1/2 -translate-x-1/2 text-center text-xs text-gray-500 max-w-[60px] sm:max-w-none sm:whitespace-nowrap">
                                    {step.name}
                                </span>
                            </>
                        )}
                    </li>
                ))}
            </ol>
        </nav>
    );
};
