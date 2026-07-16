import { Transition as TransitionComponent } from '@headlessui/react';
import FadeTransition from '@/elements/transitions/FadeTransition';

const Transition = Object.assign(TransitionComponent, {
    Fade: FadeTransition,
}) as typeof TransitionComponent & { Fade: typeof FadeTransition };

export { Transition };
