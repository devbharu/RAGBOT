/**
 * PrivateRoute.jsx — Protect routes that require authentication
 */

import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Loader2 } from "lucide-react";

export default function PrivateRoute({ children }) {
    const { isAuthenticated, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-[var(--bg-base)]">
                <Loader2 className="animate-spin text-[var(--accent)]" size={40} />
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/auth/login" replace />;
    }

    return children;
}
