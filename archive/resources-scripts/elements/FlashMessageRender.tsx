import { useStoreActions, useStoreState } from 'easy-peasy';
import { Fragment, useEffect, useRef } from 'react';

import MessageBox from '@/elements/MessageBox';
import classNames from 'classnames';

type Props = Readonly<{
    byKey?: string;
    className?: string;
}>;

function FlashMessageRender({ byKey, className }: Props) {
    const flashes = useStoreState(state => state.flashes.items.filter(flash => (byKey ? flash.key === byKey : true)));
    const removeFlash = useStoreActions(actions => actions.flashes.removeFlash);
    const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    useEffect(() => {
        const timers = timersRef.current;
        const activeIds = new Set(
            flashes.map(flash => {
                const id = flash.id ?? '';
                if (id && !timers.has(id)) {
                    timers.set(
                        id,
                        setTimeout(() => {
                            timers.delete(id);
                            removeFlash(id);
                        }, 5000),
                    );
                }
                return id;
            }),
        );

        timers.forEach((timeout, id) => {
            if (!activeIds.has(id)) {
                clearTimeout(timeout);
                timers.delete(id);
            }
        });
    }, [flashes, removeFlash]);

    useEffect(() => {
        return () => {
            timersRef.current.forEach(clearTimeout);
            timersRef.current.clear();
        };
    }, []);

    return flashes.length ? (
        <div className={classNames(className, 'fixed bottom-2 right-2 z-50 m-4')}>
            {flashes.map((flash, index) => (
                <Fragment key={flash.id || flash.type + flash.message}>
                    {index > 0 && <div className="mt-2" />}
                    <MessageBox type={flash.type} title={flash.title}>
                        {flash.message}
                    </MessageBox>
                </Fragment>
            ))}
        </div>
    ) : null;
}

export default FlashMessageRender;
