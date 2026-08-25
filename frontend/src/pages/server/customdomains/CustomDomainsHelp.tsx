import { m } from '@/i18n/messages';
import { HelpButton, HelpSteps } from '@/components/ui/HelpButton';

// The "?" guide for the server owner. Plain-language explanation of what a
// custom domain is and how to set one up, since the feature (and its SRV/CNAME
// distinction) is not obvious.
export function CustomDomainsHelp() {
    return (
        <HelpButton title={m['server.customDomains.help.title']()} label={m['server.customDomains.help.open']()}>
            <div className="flex flex-col gap-5">
                <p className="text-sm leading-relaxed text-[var(--color-ink-muted)]">
                    {m['server.customDomains.help.intro']()}
                </p>
                <HelpSteps
                    steps={[
                        { title: m['server.customDomains.help.step1.title'](), body: m['server.customDomains.help.step1.body']() },
                        { title: m['server.customDomains.help.step2.title'](), body: m['server.customDomains.help.step2.body']() },
                        { title: m['server.customDomains.help.step3.title'](), body: m['server.customDomains.help.step3.body']() },
                        { title: m['server.customDomains.help.step4.title'](), body: m['server.customDomains.help.step4.body']() },
                    ]}
                />
                <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                    <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                        {m['server.customDomains.help.records.title']()}
                    </h3>
                    <dl className="mt-2 flex flex-col gap-2 text-sm text-[var(--color-ink-muted)]">
                        <div>
                            <dt className="inline font-medium text-[var(--color-ink)]">
                                {m['server.customDomains.help.records.srv']()}{' '}
                            </dt>
                            <dd className="inline">{m['server.customDomains.help.records.srvBody']()}</dd>
                        </div>
                        <div>
                            <dt className="inline font-medium text-[var(--color-ink)]">
                                {m['server.customDomains.help.records.cname']()}{' '}
                            </dt>
                            <dd className="inline">{m['server.customDomains.help.records.cnameBody']()}</dd>
                        </div>
                    </dl>
                    <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
                        {m['server.customDomains.help.records.auto']()}
                    </p>
                </div>
            </div>
        </HelpButton>
    );
}
