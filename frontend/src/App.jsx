
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
              {/* Auth Routes */}
              <Route path="/auth/login" element={<Login />} />
              <Route path="/auth/signup" element={<Signup />} />

              {/* Protected Routes with MainLayout */}
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
              <Route
                path="/report"
                element={
                  <PrivateRoute>
                    <MainLayout>
                      <ReportPanel />
                    </MainLayout>
                  </PrivateRoute>
                }
              />

              {/* Catch-all */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AppProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
