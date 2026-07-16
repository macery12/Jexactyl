import { m } from '@/i18n';
import { useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, ChevronRight } from 'lucide-react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Panel } from './Panel';
import { useServer } from '@/components/server/ServerContext';
import { useServerSocket } from '@/state/serverSocket';
import { SocketEvent, SocketRequest } from '@/lib/Websocket';
import { usePersistedState } from '@/hooks/usePersistedState';
import { can } from '@/lib/can';
import { cn } from '@/lib/cn';

import '../console.css';

const PRELUDE = '\u001b[1m\u001b[33mM12Labs Container:\u001b[0m ';

const theme: ITheme = {
    background: 'rgba(0,0,0,0)',
    foreground: '#d4d4dc',
    cursor: 'transparent',
    black: '#000000',
    red: '#f1545b',
    green: '#18d39a',
    yellow: '#f5a623',
    blue: '#6d5efc',
    magenta: '#BB80B3',
    cyan: '#2DDAFD',
    white: '#d0d0d0',
    brightBlack: 'rgba(255,255,255,0.22)',
    brightRed: '#FF5370',
    brightGreen: '#C3E88D',
    brightYellow: '#FFCB6B',
    brightBlue: '#82AAFF',
    brightMagenta: '#C792EA',
    brightCyan: '#89DDFF',
    brightWhite: '#ffffff',
    selectionBackground: 'rgba(109,94,252,0.4)',
};

export function ConsolePanel() {
    const server = useServer();
    const ref = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const instance = useServerSocket(s => s.instance);
    const connected = useServerSocket(s => s.connected);
    const [history, setHistory] = usePersistedState<string[]>(`v2:${server.id}:command_history`, []);
    const [historyIndex, setHistoryIndex] = useState(-1);

    const canSend = can(server.permissions, 'control.console');

    useEffect(() => {
        if (!ref.current) return;
        const term = new Terminal({
            disableStdin: true,
            cursorStyle: 'underline',
            allowTransparency: true,
            fontSize: 12.5,
            lineHeight: 1.2,
            fontFamily: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
            theme,
            allowProposedApi: true,
            convertEol: true,
            scrollback: 2000,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.loadAddon(new WebLinksAddon());
        term.loadAddon(new SearchAddon());
        term.open(ref.current);
        fit.fit();
        termRef.current = term;

        const onResize = () => fit.fit();
        window.addEventListener('resize', onResize);
        const ro = new ResizeObserver(() => fit.fit());
        ro.observe(ref.current);

        return () => {
            window.removeEventListener('resize', onResize);
            ro.disconnect();
            term.dispose();
            termRef.current = null;
        };
    }, []);

    useEffect(() => {
        const term = termRef.current;
        if (!instance || !term) return;

        const write = (line: string, prelude = false) =>
            term.writeln((prelude ? PRELUDE : '') + line.replace(/(?:\r\n|\r|\n)$/im, '') + '\u001b[0m');

        const onOutput = (line: unknown) => write(String(line ?? ''));
        const onDaemonError = (line: unknown) =>
            term.writeln(PRELUDE + '\u001b[1m\u001b[41m' + String(line ?? '') + '\u001b[0m');
        const onStatus = (state: unknown) => write(`Server marked as ${String(state)}...`, true);

        instance.on(SocketEvent.CONSOLE_OUTPUT, onOutput);
        instance.on(SocketEvent.INSTALL_OUTPUT, onOutput);
        instance.on(SocketEvent.DAEMON_ERROR, onDaemonError);
        instance.on(SocketEvent.STATUS, onStatus);

        if (connected) {
            term.clear();
            instance.send(SocketRequest.SEND_LOGS);
        }

        return () => {
            instance.off(SocketEvent.CONSOLE_OUTPUT, onOutput);
            instance.off(SocketEvent.INSTALL_OUTPUT, onOutput);
            instance.off(SocketEvent.DAEMON_ERROR, onDaemonError);
            instance.off(SocketEvent.STATUS, onStatus);
        };
    }, [instance, connected]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const input = e.currentTarget;
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const next = Math.min(historyIndex + 1, history.length - 1);
            setHistoryIndex(next);
            input.value = history[next] || '';
        } else if (e.key === 'ArrowDown') {
            const next = Math.max(historyIndex - 1, -1);
            setHistoryIndex(next);
            input.value = history[next] || '';
        } else if (e.key === 'Enter' && input.value.length > 0) {
            const command = input.value;
            setHistory(prev => [command, ...prev].slice(0, 32));
            setHistoryIndex(-1);
            instance?.send(SocketRequest.SEND_COMMAND, command);
            input.value = '';
        }
    };

    return (
        <Panel
            title={m['server.console.title']()}
            icon={TerminalIcon}
            className="min-h-[26rem] w-full"
            flush
            right={
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                    <span
                        className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            connected ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-warning)] animate-pulse',
                        )}
                    />
                    {connected ? m['server.console.connected']() : m['server.console.connecting']()}
                </span>
            }
        >
            <div className="flex h-full flex-col p-2">
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-sm bg-[#08080c] p-2">
                    {!connected && (
                        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center font-mono text-xs text-[var(--color-ink-faint)]">
                            {m['server.console.establishing']()}
                        </div>
                    )}
                    <div ref={ref} className="h-full w-full" />
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-sm border border-[var(--color-border-strong)] bg-[#08080c] px-2.5">
                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-accent)]" />
                    <input
                        type="text"
                        disabled={!canSend || !connected}
                        onKeyDown={onKeyDown}
                        placeholder={canSend ? m['server.console.placeholder']() : m['server.console.permissionRequired']()}
                        className="h-10 w-full bg-transparent font-mono text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)] disabled:cursor-not-allowed"
                        spellCheck={false}
                        autoComplete="off"
                    />
                </div>
            </div>
        </Panel>
    );
}
