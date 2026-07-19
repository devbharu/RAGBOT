/**
 * App.jsx — Simple Lazy Load Loader
 */

import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { AuthProvider } from "./context/AuthContext";
import { AppProvider } from "./context/AppContext";
import { ThemeProvider } from "./context/ThemeContext";
import PrivateRoute from "./components/PrivateRoute";
import { Toaster } from "react-hot-toast";

// Lazy imports
const MainLayout = lazy(() => import("./components/MainLayout"));
const Chatbot = lazy(() => import("./components/Chatbot"));
const ReportPanel = lazy(() => import("./components/ReportPanel"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));

const Loader = () => (
  <div className="w-screen h-screen flex items-center justify-center bg-[var(--bg-surface)]">
    <Loader2 size={32} className="animate-spin text-[var(--accent)]" />
  </div>
);

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppProvider>
          <Toaster position="top-right" toastOptions={{ style: { background: 'var(--bg-panel)', color: 'var(--text-body)', border: '1px solid var(--border)', fontSize: '13px', fontFamily: "'JetBrains Mono', monospace" } }} />
          <BrowserRouter>
            <Suspense fallback={<Loader />}>
              <Routes>
                {/* Auth */}
                <Route path="/auth/login" element={<Login />} />
                <Route path="/auth/signup" element={<Signup />} />

                {/* Chat */}
                <Route
                  path="/"
                  element={
                    <PrivateRoute>
                      <MainLayout>
                        <Chatbot />
                      </MainLayout>
                    </PrivateRoute>
                  }
                />

                {/* Report */}
                <Route
                  path="/report"
                  element={
                    <PrivateRoute>
                      <ReportPanel />
                    </PrivateRoute>
                  }
                />



                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AppProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
