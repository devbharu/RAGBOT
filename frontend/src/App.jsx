/**
 * App.jsx — CMTI v8.0
 * ReportPanel is full-screen (no sidebar), Chatbot uses MainLayout
 */

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { AppProvider } from "./context/AppContext";
import { ThemeProvider } from "./context/ThemeContext";
import PrivateRoute from "./components/PrivateRoute";
import MainLayout from "./components/MainLayout";
import Chatbot from "./components/Chatbot";
import ReportPanel from "./components/ReportPanel";
import Login from "./pages/Login";
import Signup from "./pages/Signup";

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppProvider>
          <BrowserRouter>
            <Routes>
              {/* Auth */}
              <Route path="/auth/login" element={<Login />} />
              <Route path="/auth/signup" element={<Signup />} />

              {/* Chat — uses sidebar layout */}
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

              {/* Report — full-screen editor, no sidebar */}
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
          </BrowserRouter>
        </AppProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}