/**
 * AuthContext.jsx — Authentication state management
 * Handles login, signup, logout, token persistence
 */

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import axios from "axios";

export const API = "http://127.0.0.1:8080";

// ─── Context ───────────────────────────────────────────────────
const AuthContext = createContext(null);

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
};

// ─── Provider ──────────────────────────────────────────────────
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem("access_token") || null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Setup axios interceptor to attach token to all requests
    useEffect(() => {
        if (token) {
            axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
        } else {
            delete axios.defaults.headers.common["Authorization"];
        }
    }, [token]);

    // Check if user is already logged in (using stored token)
    useEffect(() => {
        const checkAuth = async () => {
            if (token) {
                try {
                    const res = await axios.get(`${API}/auth/me`, {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    setUser(res.data.user);
                } catch (err) {
                    console.error("Token validation failed:", err);
                    setToken(null);
                    localStorage.removeItem("access_token");
                    localStorage.removeItem("refresh_token");
                }
            }
            setLoading(false);
        };
        checkAuth();
    }, []);

    // Signup
    const signup = useCallback(async (username, email, password) => {
        setError(null);
        try {
            const res = await axios.post(`${API}/auth/signup`, {
                username,
                email,
                password,
            });
            const { user, access_token, refresh_token } = res.data;
            setUser(user);
            setToken(access_token);
            localStorage.setItem("access_token", access_token);
            localStorage.setItem("refresh_token", refresh_token);
            return { success: true, user };
        } catch (err) {
            const errMsg = err.response?.data?.error || "Signup failed";
            setError(errMsg);
            return { success: false, error: errMsg };
        }
    }, []);

    // Login
    const login = useCallback(async (emailOrUsername, password) => {
        setError(null);
        try {
            const res = await axios.post(`${API}/auth/login`, {
                email: emailOrUsername.includes("@") ? emailOrUsername : undefined,
                username: !emailOrUsername.includes("@") ? emailOrUsername : undefined,
                password,
            });
            const { user, access_token, refresh_token } = res.data;
            setUser(user);
            setToken(access_token);
            localStorage.setItem("access_token", access_token);
            localStorage.setItem("refresh_token", refresh_token);
            return { success: true, user };
        } catch (err) {
            const errMsg = err.response?.data?.error || "Login failed";
            setError(errMsg);
            return { success: false, error: errMsg };
        }
    }, []);

    // Logout
    const logout = useCallback(async () => {
        try {
            await axios.post(`${API}/auth/logout`);
        } catch (err) {
            console.error("Logout API call failed:", err);
        } finally {
            setUser(null);
            setToken(null);
            localStorage.removeItem("access_token");
            localStorage.removeItem("refresh_token");
            delete axios.defaults.headers.common["Authorization"];
        }
    }, []);

    // Refresh token
    const refreshToken = useCallback(async () => {
        try {
            const refreshToken = localStorage.getItem("refresh_token");
            if (!refreshToken) throw new Error("No refresh token");
            
            const res = await axios.post(
                `${API}/auth/refresh`,
                {},
                { headers: { Authorization: `Bearer ${refreshToken}` } }
            );
            const newAccessToken = res.data.access_token;
            setToken(newAccessToken);
            localStorage.setItem("access_token", newAccessToken);
            return true;
        } catch (err) {
            console.error("Token refresh failed:", err);
            logout();
            return false;
        }
    }, [logout]);

    const value = {
        user,
        token,
        loading,
        error,
        isAuthenticated: !!user && !!token,
        signup,
        login,
        logout,
        refreshToken,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
