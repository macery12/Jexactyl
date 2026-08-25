import { m } from '@/i18n/messages';
import { HelpButton, HelpSteps } from '@/components/ui/HelpButton';

// The "?" guide for operators. This module is a Cloudflare-backed vanity-domain
// system and its moving parts (zones, API tokens, per-egg SRV service tags) are
// not obvious — this walkthrough explains the whole setup end to end.
export function AdminCustomDomainsHelp() {
    return (
        <HelpButton title={m['admin.customDomains.help.title']()} label={m['admin.customDomains.help.open']()}>
            <div className="flex flex-col gap-5">
                <p className="text-sm leading-relaxed text-[var(--color-ink-muted)]">
                    {m['admin.customDomains.help.intro']()}
                </p>
                <HelpSteps
                    steps={[
                        { title: m['admin.customDomains.help.step1.title'](), body: m['admin.customDomains.help.step1.body']() },
                        { title: m['admin.customDomains.help.step2.title'](), body: m['admin.customDomains.help.step2.body']() },
                        { title: m['admin.customDomains.help.step3.title'](), body: m['admin.customDomains.help.step3.body']() },
                        { title: m['admin.customDomains.help.step4.title'](), body: m['admin.customDomains.help.step4.body']() },
                    ]}
                />
                <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                    <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                        {m['admin.customDomains.help.concepts.title']()}
                    </h3>
                    <dl className="mt-2 flex flex-col gap-2 text-sm text-[var(--color-ink-muted)]">
                        <div>
                            <dt className="inline font-medium text-[var(--color-ink)]">
                                {m['admin.customDomains.help.concepts.zone']()}{' '}
                            </dt>
                            <dd className="inline">{m['admin.customDomains.help.concepts.zoneBody']()}</dd>
                        </div>
                        <div>
                            <dt className="inline font-medium text-[var(--color-ink)]">
                                {m['admin.customDomains.help.concepts.apiKey']()}{' '}
                            </dt>
                            <dd className="inline">{m['admin.customDomains.help.concepts.apiKeyBody']()}</dd>
                        </div>
                        <div>
                            <dt className="inline font-medium text-[var(--color-ink)]">
                                {m['admin.customDomains.help.concepts.serviceTag']()}{' '}
                            </dt>
                            <dd className="inline">{m['admin.customDomains.help.concepts.serviceTagBody']()}</dd>
                        </div>
                        <div>
                            <dt className="inline font-medium text-[var(--color-ink)]">
                                {m['admin.customDomains.help.concepts.restrictions']()}{' '}
                            </dt>
                            <dd className="inline">{m['admin.customDomains.help.concepts.restrictionsBody']()}</dd>
                        </div>
                    </dl>
                </div>
            </div>
        </HelpButton>
    );
}
