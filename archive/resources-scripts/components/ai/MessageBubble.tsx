import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SparklesIcon, ClipboardCopyIcon, CheckIcon } from '@heroicons/react/outline';

export interface Message {
    role: 'user' | 'assistant';
    content: string;
    streaming?: boolean;
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <button
            onClick={handleCopy}
            className={
                'absolute top-2 right-2 rounded p-1 opacity-0 transition-all group-hover:opacity-100 hover:bg-neutral-700'
            }
            title={'Copy response'}
        >
            {copied ? (
                <CheckIcon className={'h-3.5 w-3.5 text-green-400'} />
            ) : (
                <ClipboardCopyIcon className={'h-3.5 w-3.5 text-neutral-400'} />
            )}
        </button>
    );
}

export default function MessageBubble({ message }: { message: Message }) {
    const isUser = message.role === 'user';

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
            {!isUser && (
                <div
                    className={
                        'mr-2 mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-violet-600'
                    }
                >
                    <SparklesIcon className={'h-4 w-4 text-white'} />
                </div>
            )}
            <div
                className={`group relative max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    isUser ? 'rounded-tr-sm bg-violet-600 text-white' : 'rounded-tl-sm bg-neutral-800 text-neutral-100'
                }`}
            >
                {isUser ? (
                    <div className={'whitespace-pre-wrap break-words'}>{message.content}</div>
                ) : (
                    <>
                        <div
                            className={
                                'prose prose-sm prose-invert max-w-none break-words prose-p:my-1 prose-p:leading-relaxed prose-headings:text-neutral-100 prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-code:bg-neutral-700 prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-pre:bg-neutral-900 prose-pre:rounded-lg prose-pre:p-3 prose-pre:overflow-x-auto prose-strong:text-neutral-100 prose-a:text-violet-400 prose-a:no-underline hover:prose-a:underline prose-hr:border-neutral-700'
                            }
                        >
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        </div>
                        {!message.streaming && message.content.length > 0 && <CopyButton text={message.content} />}
                    </>
                )}
                {message.streaming && (
                    <span className={'ml-1 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-current opacity-70'} />
                )}
            </div>
            {isUser && (
                <div
                    className={
                        'ml-2 mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-600'
                    }
                >
                    <span className={'text-xs font-bold text-white'}>U</span>
                </div>
            )}
        </div>
    );
}
