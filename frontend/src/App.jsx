
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { AppProvider } from "./context/AppContext";
import PrivateRoute from "./components/PrivateRoute";
import Chatbot from "./components/Chatbot";
import ReportPanel from "./components/ReportPanel";
import Login from "./pages/Login";
import Signup from "./pages/Signup";


export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <BrowserRouter>
          <Routes>
            {/* Auth Routes */}
            <Route path="/auth/login" element={<Login />} />
            <Route path="/auth/signup" element={<Signup />} />

            {/* Protected Routes */}
            <Route
              path="/"
              element={
                <PrivateRoute>
                  <Chatbot />
                </PrivateRoute>
              }
            />
            <Route
              path="/report"
              element={
                <PrivateRoute>
                  <ReportPanel />
                </PrivateRoute>
              }
            />

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AppProvider>
    </AuthProvider>
  );
}