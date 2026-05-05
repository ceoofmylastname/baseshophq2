import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequireOwner } from "@/components/auth/RequireOwner";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { LoginPage } from "@/pages/Login";
import { SignupPage } from "@/pages/Signup";
import { DashboardPage } from "@/pages/Dashboard";
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
import { SettingsPage } from "@/pages/Settings";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login"  element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          <Route
            element={
              <RequireAuth>
                <DashboardShell />
              </RequireAuth>
            }
          >
            <Route path="/"          element={<Navigate to="/dashboard" replace />} />
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
            <Route path="/my-rates"  element={<MyRatesPage />} />
            <Route path="/settings"  element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
