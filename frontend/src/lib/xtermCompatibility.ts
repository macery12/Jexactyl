import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

type QueueTask = (complete: () => void) => void;

/**
 * Serializes parser writes and fits. xterm 6.0 can corrupt its visible buffer
 * when a resize races queued output, so a fit must wait for writeln's parser
 * callback before changing the terminal dimensions.
 */
export class XtermWriteResizeQueue {
    private readonly tasks: QueueTask[] = [];
    private running = false;
    private fitQueued = false;
    private disposed = false;

    constructor(
        private readonly terminal: Terminal,
        private readonly fitAddon: FitAddon,
        private readonly replayLogs: () => void,
    ) {}

    writeLine(data: string): void {
        this.enqueue(complete => this.terminal.writeln(data, complete));
    }

    clear(complete?: () => void): void {
        this.enqueue(done => {
            this.terminal.clear();
            complete?.();
            done();
        });
    }

    fit(): void {
        if (this.fitQueued || this.disposed) return;

        this.fitQueued = true;
        this.enqueue(complete => {
            this.fitQueued = false;
            this.fitSafely();
            complete();
        });
    }

    dispose(): void {
        this.disposed = true;
        this.tasks.length = 0;
    }

    private enqueue(task: QueueTask): void {
        if (this.disposed) return;

        this.tasks.push(task);
        this.runNext();
    }

    private runNext(): void {
        if (this.running || this.disposed) return;

        const task = this.tasks.shift();
        if (!task) return;

        this.running = true;
        task(() => {
            this.running = false;
            this.runNext();
        });
    }

    private fitSafely(): void {
        let needsRecovery = !this.hasCompleteViewport();

        if (!needsRecovery) {
            try {
                this.fitAddon.fit();
            } catch {
                needsRecovery = true;
            }
        }

        if (!needsRecovery && this.hasCompleteViewport()) return;

        // A reset is preferable to leaving a terminal which will throw on its
        // next write. Wings immediately supplies a fresh scrollback snapshot.
        this.tasks.length = 0;
        this.terminal.reset();
        this.fitAddon.fit();
        this.replayLogs();
    }

    private hasCompleteViewport(): boolean {
        const buffer = this.terminal.buffer.active;
        return buffer.getLine(buffer.baseY + this.terminal.rows - 1) !== undefined;
    }
}

/**
 * Backport the touch-drag behavior fixed upstream after xterm 6.0.0. This uses
 * only the public scrolling API and can be removed once that fix is released.
 */
export function enableXtermTouchScrolling(element: HTMLElement, terminal: Terminal): () => void {
    let previousY: number | undefined;
    let pendingPixels = 0;

    const resetGesture = () => {
        previousY = undefined;
        pendingPixels = 0;
    };
    const onTouchStart = (event: TouchEvent) => {
        const touch = event.touches.item(0);
        if (event.touches.length !== 1 || !touch) {
            resetGesture();
            return;
        }

        previousY = touch.clientY;
        pendingPixels = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
        const touch = event.touches.item(0);
        if (previousY === undefined || event.touches.length !== 1 || !touch) return;

        const currentY = touch.clientY;
        pendingPixels += previousY - currentY;
        previousY = currentY;

        event.preventDefault();
        event.stopPropagation();

        const pixelsPerRow = element.clientHeight / Math.max(terminal.rows, 1);
        if (pixelsPerRow <= 0) return;

        const rows = pendingPixels < 0 ? Math.ceil(pendingPixels / pixelsPerRow) : Math.floor(pendingPixels / pixelsPerRow);
        if (rows === 0) return;

        terminal.scrollLines(rows);
        pendingPixels -= rows * pixelsPerRow;
    };

    const listenerOptions: AddEventListenerOptions = { capture: true, passive: false };
    element.addEventListener('touchstart', onTouchStart, listenerOptions);
    element.addEventListener('touchmove', onTouchMove, listenerOptions);
    element.addEventListener('touchend', resetGesture, true);
    element.addEventListener('touchcancel', resetGesture, true);

    return () => {
        element.removeEventListener('touchstart', onTouchStart, true);
        element.removeEventListener('touchmove', onTouchMove, true);
        element.removeEventListener('touchend', resetGesture, true);
        element.removeEventListener('touchcancel', resetGesture, true);
    };
}
