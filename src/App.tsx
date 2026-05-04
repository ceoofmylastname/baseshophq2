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
import { MyRatesPage } from "@/pages/MyRates";
import { MasterGridPage } from "@/pages/MasterGrid";
import { PoliciesPage } from "@/pages/Policies";
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
            <Route path="/policies"  element={<PoliciesPage />} />
            <Route path="/my-rates"  element={<MyRatesPage />} />
            <Route path="/settings"  element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
