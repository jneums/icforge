import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ErrorBoundary } from "react-error-boundary";
import { AuthProvider } from "./contexts/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "./components/app-shell";
import { ErrorFallback } from "./components/error-fallback";
import { RequireAuth } from "./components/require-auth";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import DeployDetail from "./pages/DeployDetail";
import CanisterDetail from "./pages/CanisterDetail";

import Billing from "./pages/Billing";
import NewProject from "./pages/NewProject";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <AppShell>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/projects" element={<RequireAuth><Projects /></RequireAuth>} />
              <Route path="/projects/new" element={<RequireAuth><NewProject /></RequireAuth>} />
              <Route path="/projects/:id" element={<RequireAuth><ProjectDetail /></RequireAuth>} />
              <Route path="/projects/:id/canisters/:canisterId" element={<RequireAuth><CanisterDetail /></RequireAuth>} />
              <Route path="/projects/:id/deploys/:deployId" element={<RequireAuth><DeployDetail /></RequireAuth>} />
              <Route path="/billing" element={<RequireAuth><Billing /></RequireAuth>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppShell>
        </ErrorBoundary>
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  );
}
