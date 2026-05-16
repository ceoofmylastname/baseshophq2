import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequireOwner } from "@/components/auth/RequireOwner";
import { PublicOrRedirect } from "@/components/auth/PublicOrRedirect";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { MarketingPage } from "@/pages/Marketing";
import { LoginPage } from "@/pages/Login";
import { SignupPage } from "@/pages/Signup";
import { AcceptInvitePage } from "@/pages/AcceptInvite";
import { ResetPasswordPage } from "@/pages/ResetPassword";
import { DashboardPage } from "@/pages/Dashboard";
import { HomePage } from "@/pages/Home";
import { AgentsPage } from "@/pages/Agents";
import { AgentProfilePage } from "@/pages/AgentProfile";
import { IngestPage } from "@/pages/Ingest";
import { IngestRunDetailPage } from "@/pages/IngestRunDetail";
import { MyRatesPage } from "@/pages/MyRates";
import { MasterGridPage } from "@/pages/MasterGrid";
import { BookOfBusinessPage } from "@/pages/BookOfBusiness";
import { PolicyDetailPage } from "@/pages/PolicyDetail";
import { ProductionPage } from "@/pages/Production";
import { ScoreboardPage } from "@/pages/Scoreboard";
import { ActiveAgentsPage } from "@/pages/ActiveAgents";
import { ContractsPage } from "@/pages/Contracts";
import { SettingsPage } from "@/pages/Settings";
import { BillingPage } from "@/pages/Billing";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public marketing homepage. Logged-in users redirected to /home. */}
          <Route
            path="/"
            element={
              <PublicOrRedirect>
                <MarketingPage />
              </PublicOrRedirect>
            }
          />

          <Route path="/login"  element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          {/* Magic-link landing pages. Both require a session (from clicking
              the email link) and have their own redirect-if-not-signed-in
              guards built in. NOT wrapped in DashboardShell — these are
              full-screen auth flows with their own chrome. */}
          <Route path="/accept-invite"   element={<AcceptInvitePage />} />
          <Route path="/reset-password"  element={<ResetPasswordPage />} />

          <Route
            element={
              <RequireAuth>
                <DashboardShell />
              </RequireAuth>
            }
          >
            <Route path="/home"      element={<HomePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/agents"           element={<AgentsPage />} />
            <Route path="/agents/:agentId"  element={<AgentProfilePage />} />
            <Route path="/comp-grid" element={<Navigate to="/master-grid" replace />} />
            <Route
              path="/master-grid"
              element={
                <RequireOwner>
                  <MasterGridPage />
                </RequireOwner>
              }
            />
            <Route
              path="/ingest"
              element={
                <RequireOwner>
                  <IngestPage />
                </RequireOwner>
              }
            />
            <Route
              path="/ingest/history/:runId"
              element={
                <RequireOwner>
                  <IngestRunDetailPage />
                </RequireOwner>
              }
            />
            <Route path="/policies"        element={<Navigate to="/book-of-business" replace />} />
            <Route path="/book-of-business" element={<BookOfBusinessPage />} />
            <Route path="/policy/:policyId" element={<PolicyDetailPage />} />
            <Route path="/production"      element={<ProductionPage />} />
            <Route path="/team-production" element={<ProductionPage teamView />} />
            <Route path="/scoreboard"      element={<ScoreboardPage />} />
            <Route path="/active-agents"   element={<ActiveAgentsPage />} />
            <Route path="/contracts"       element={<ContractsPage />} />
            <Route path="/my-rates"  element={<MyRatesPage />} />
            <Route path="/settings"  element={<SettingsPage />} />
            <Route path="/billing"   element={<BillingPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors closeButton position="top-right" theme="dark" />
    </AuthProvider>
  );
}
