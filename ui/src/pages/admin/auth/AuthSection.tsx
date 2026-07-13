import { Routes, Route, Navigate } from 'react-router-dom';
import AuthModulesPage from './AuthModulesPage';
import JGuardSettingsPage from './JGuardSettingsPage';
import JGuardPendingPage from './JGuardPendingPage';
import { AuthNav } from './AuthNav';

// Mounted at the admin `auth/*` splat route. Owns the authentication module
// overview plus the jGuard settings + pending-accounts sub-pages. Secondary
// navigation lives here as an in-page rail (not on the main admin sidebar).
// jGuard routes fall back to the overview when the module is disabled.
export default function AuthSection() {
    const jguardEnabled = Boolean(window.EverestConfiguration?.auth.modules.jguard.enabled);

    return (
        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
            <AuthNav />
            <div className="min-w-0 flex-1">
                <Routes>
                    <Route index element={<AuthModulesPage />} />
                    {jguardEnabled ? (
                        <>
                            <Route path="jguard" element={<JGuardSettingsPage />} />
                            <Route path="jguard/pending" element={<JGuardPendingPage />} />
                        </>
                    ) : (
                        <Route path="jguard/*" element={<Navigate to="/v2/admin/auth" replace />} />
                    )}
                    <Route path="*" element={<Navigate to="/v2/admin/auth" replace />} />
                </Routes>
            </div>
        </div>
    );
}
