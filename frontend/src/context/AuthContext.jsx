/**
 * AuthContext.jsx — Authentication state management
 * Handles login, signup, logout, token persistence
 */

/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
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
    const [token, setToken] = useState(null); // Start null - validated on mount
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const pendingPrefsUpdate = useRef({});
    const prefsTimeout = useRef(null);

    const syncPreferences = useCallback((updates) => {
        // Update local state immediately
        setUser(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                preferences: {
                    ...(prev.preferences || {}),
                    ...updates
                }
            };
        });

        // Queue for backend sync
        pendingPrefsUpdate.current = { ...pendingPrefsUpdate.current, ...updates };
        
        if (prefsTimeout.current) clearTimeout(prefsTimeout.current);
        
        prefsTimeout.current = setTimeout(async () => {
            const payload = { ...pendingPrefsUpdate.current };
            pendingPrefsUpdate.current = {}; // reset queue
            try {
                const currentToken = axios.defaults.headers.common["Authorization"]?.replace("Bearer ", "") || localStorage.getItem("access_token");
                if (currentToken) {
                    await axios.put(`${API}/auth/preferences`, payload, {
                        headers: { Authorization: `Bearer ${currentToken}` }
                    });
                }
            } catch (err) {
                console.error("[AUTH] Failed to sync preferences", err);
            }
        }, 1500); // 1.5s debounce
    }, []);

    // Check if user is already logged in (using stored token) — RUN FIRST
    useEffect(() => {
        const checkAuth = async () => {
            console.log("[AUTH] Checking stored session...");
            const storedToken = localStorage.getItem("access_token");
            
            if (!storedToken) {
                console.log("[AUTH] No stored token found");
                setLoading(false);
                return;
            }

            console.log(`[AUTH] Found token in storage (length: ${storedToken.length})`);
            console.log(`[AUTH] Token preview: ${storedToken.substring(0, 50)}...`);

            try {
                console.log("[AUTH] Validating token with backend...");
                const res = await axios.get(`${API}/auth/me`, {
                    headers: { Authorization: `Bearer ${storedToken}` },
                });
                console.log("[AUTH] ✓ Token is valid, user:", res.data.user.username);
                axios.defaults.headers.common["Authorization"] = `Bearer ${storedToken}`;
                setToken(storedToken);
                setUser(res.data.user);
            } catch (err) {
                console.warn("[AUTH] ✗ Token validation failed:", err.response?.status, err.response?.data?.error);
                console.error("[AUTH] Full error:", err.response?.data);
                // Clear invalid tokens and stale cache
                localStorage.clear();
                sessionStorage.clear();
                setToken(null);
                setUser(null);
            } finally {
                setLoading(false);
            }
        };
        checkAuth();
    }, []);

    // Setup axios response interceptor to handle 401s
    useEffect(() => {
        const interceptor = axios.interceptors.response.use(
            (response) => response,
            async (error) => {
                const config = error.config;
                // If 401, not a retry, and NOT a refresh request itself
                if (error.response?.status === 401 && !config?._retry && !config?.url?.includes("/auth/refresh")) {
                    config._retry = true;
                    console.log("[AUTH] Got 401, attempting token refresh...");
                    
                    try {
                        const storedRefreshToken = localStorage.getItem("refresh_token");
                        if (storedRefreshToken) {
                            const res = await axios.post(
                                `${API}/auth/refresh`,
                                {},
                                { headers: { Authorization: `Bearer ${storedRefreshToken}` } }
                            );
                            const newAccessToken = res.data.access_token;
                            localStorage.setItem("access_token", newAccessToken);
                            config.headers.Authorization = `Bearer ${newAccessToken}`;
                            setToken(newAccessToken);
                            console.log("[AUTH] ✓ Token refreshed via interceptor, retrying request");
                            return axios(config);
                        }
                    } catch {
                        console.error("[AUTH] ✗ Refresh failed in interceptor, logging out");
                        // Refresh failed, logout
                        setUser(null);
                        setToken(null);
                        localStorage.clear();
                        sessionStorage.clear();
                        delete axios.defaults.headers.common["Authorization"];
                    }
                }
                return Promise.reject(error);
            }
        );

        return () => axios.interceptors.response.eject(interceptor);
    }, []);

    // Setup axios request header ONLY after token is validated
    useEffect(() => {
        if (token) {
            console.log("[AUTH] Setting axios Authorization header");
            axios.defaults.headers.common["Authorization"] = `Bearer ${token}`;
        } else {
            console.log("[AUTH] Removing axios Authorization header");
            delete axios.defaults.headers.common["Authorization"];
        }
    }, [token]);

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
            axios.defaults.headers.common["Authorization"] = `Bearer ${access_token}`;
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
            axios.defaults.headers.common["Authorization"] = `Bearer ${access_token}`;
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
            console.log("[AUTH] Calling logout endpoint");
            await axios.post(`${API}/auth/logout`);
        } catch (err) {
            console.warn("[AUTH] Logout API call failed (expected if token expired):", err.message);
        } finally {
            console.log("[AUTH] Clearing local session");
            setUser(null);
            setToken(null);
            localStorage.clear();
            sessionStorage.clear();
            delete axios.defaults.headers.common["Authorization"];
        }
    }, []);

    // Refresh token
    const refreshToken = useCallback(async () => {
        try {
            const storedRefreshToken = localStorage.getItem("refresh_token");
            if (!storedRefreshToken) {
                console.warn("[AUTH] No refresh token in storage");
                await logout();
                return false;
            }
            
            console.log("[AUTH] Attempting to refresh token...");
            const res = await axios.post(
                `${API}/auth/refresh`,
                {},
                { headers: { Authorization: `Bearer ${storedRefreshToken}` } }
            );
            const newAccessToken = res.data.access_token;
            setToken(newAccessToken);
            localStorage.setItem("access_token", newAccessToken);
            console.log("[AUTH] ✓ Token refreshed successfully");
            return true;
        } catch (err) {
            console.error("[AUTH] ✗ Token refresh failed:", err.response?.status, err.response?.data?.error);
            // Clear everything on refresh failure
            await logout();
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
        syncPreferences,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
