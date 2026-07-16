import { Route, Routes } from 'react-router-dom';
import EmailActivityLog from '@/components/admin/modules/email/EmailActivityLog';
import DeferredQueueViewer from '@/components/admin/modules/email/DeferredQueueViewer';
import PageContentBlock from '@/elements/PageContentBlock';
import { SubNavigation, SubNavigationLink } from '@admin/SubNavigation';
import ContentBox from '@/elements/ContentBox';
import ResendSettings from '@/components/admin/modules/email/ResendSettings';
import NotificationSettings from '@/components/admin/modules/email/NotificationSettings';
import VerificationRestrictions from '@/components/admin/modules/email/VerificationRestrictions';
import TemplateViewer from '@/components/admin/modules/email/TemplateViewer';

export default () => {
    return (
        <PageContentBlock title={'Email Management'}>
            <SubNavigation>
                <SubNavigationLink to="/admin/email" name="Settings" base />
                <SubNavigationLink to="/admin/email/notifications" name="Notifications" />
                <SubNavigationLink to="/admin/email/activity" name="Activity Log" />
                <SubNavigationLink to="/admin/email/queue" name="Deferred Queue" />
                <SubNavigationLink to="/admin/email/verification" name="Verification Restrictions" />
                <SubNavigationLink to="/admin/email/templates" name="Template Editor" />
            </SubNavigation>

            <Routes>
                <Route
                    path="/"
                    element={
                        <>
                            <ContentBox title={'Email Configuration'} showFlashes={'email:settings'}>
                                <ResendSettings />
                            </ContentBox>
                        </>
                    }
                />
                <Route
                    path="/notifications"
                    element={
                        <ContentBox title={'Email Notification Settings'} showFlashes={'email:notifications'}>
                            <NotificationSettings />
                        </ContentBox>
                    }
                />
                <Route
                    path="/activity"
                    element={
                        <ContentBox title={'Email Activity Log'} showFlashes={'email:activity'}>
                            <EmailActivityLog />
                        </ContentBox>
                    }
                />
                <Route
                    path="/queue"
                    element={
                        <ContentBox title={'Deferred Email Queue'} showFlashes={'email:deferred'}>
                            <DeferredQueueViewer />
                        </ContentBox>
                    }
                />
                <Route
                    path="/verification"
                    element={
                        <ContentBox title={'Verification Restrictions'} showFlashes={'email:verification'}>
                            <VerificationRestrictions />
                        </ContentBox>
                    }
                />
                <Route
                    path="/templates"
                    element={
                        <ContentBox title={'Email Template Editor'} showFlashes={'email:templates'}>
                            <TemplateViewer />
                        </ContentBox>
                    }
                />
            </Routes>
        </PageContentBlock>
    );
};
