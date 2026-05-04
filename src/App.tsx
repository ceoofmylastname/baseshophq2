import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequireOwner } from "@/components/auth/RequireOwner";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { LoginPage } from "@/pages/Login";
import { SignupPage } from "@/pages/Signup";
import { DashboardPage } from "@/pages/Dashboard";
import { AgentsPage } from "@/pages/Agents";
import { CompGridPage } from "@/pages/CompGrid";
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
            <Route path="/agents"    element={<AgentsPage />} />
            <Route
              path="/comp-grid"
              element={
                <RequireOwner>
                  <CompGridPage />
                </RequireOwner>
              }
            />
            <Route path="/policies"  element={<PoliciesPage />} />
            <Route path="/settings"  element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
