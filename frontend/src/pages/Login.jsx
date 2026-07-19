/**
 * Login.jsx — User login page
 */

import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Mail, Lock, Loader2, AlertCircle } from "lucide-react";

export default function Login() {
    const { login, isAuthenticated, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    
    const [emailOrUsername, setEmailOrUsername] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // Redirect if already logged in
    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            navigate("/");
        }
    }, [isAuthenticated, authLoading, navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        
        const result = await login(emailOrUsername, password);
        setLoading(false);
        
        if (result.success) {
            navigate("/");
        } else {
            setError(result.error);
        }
    };

    if (authLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-[var(--bg-base)]">
                <Loader2 className="animate-spin text-[var(--accent)]" size={40} />
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)] p-4">
            <div className="w-full max-w-md">
                {/* Header */}
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2" style={{ fontFamily: "'Fraunces', serif" }}>
                        RAG Bot
                    </h1>
                    <p className="text-[var(--text-muted)] font-mono text-sm">Sign in to your account</p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="bg-[var(--bg-panel)] border border-[var(--border-mid)] rounded-xl p-6 space-y-5">
                    
                    {/* Error Message */}
                    {error && (
                        <div className="flex items-center gap-3 p-4 rounded-lg" style={{ background: "var(--red-dim)", border: "1px solid var(--red-border)" }}>
                            <AlertCircle size={18} className="flex-shrink-0" style={{ color: "var(--red-soft)" }} />
                            <p className="text-sm font-mono" style={{ color: "var(--red-soft)" }}>{error}</p>
                        </div>
                    )}

                    {/* Email/Username */}
                    <div>
                        <label className="text-xs font-mono text-[var(--text-faint)] tracking-widest uppercase block mb-2">
                            Email or Username
                        </label>
                        <div className="relative">
                            <Mail size={16} className="absolute left-3 top-3 text-[var(--text-muted)]" />
                            <input
                                type="text"
                                value={emailOrUsername}
                                onChange={(e) => setEmailOrUsername(e.target.value)}
                                placeholder="john@example.com or john_doe"
                                required
                                className="w-full pl-10 pr-4 py-2.5 bg-[var(--bg-base)] border border-[var(--border-mid)] rounded-lg text-[var(--text-primary)] text-sm placeholder-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none transition-colors"
                            />
                        </div>
                    </div>

                    {/* Password */}
                    <div>
                        <label className="text-xs font-mono text-[var(--text-faint)] tracking-widest uppercase block mb-2">
                            Password
                        </label>
                        <div className="relative">
                            <Lock size={16} className="absolute left-3 top-3 text-[var(--text-muted)]" />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                className="w-full pl-10 pr-4 py-2.5 bg-[var(--bg-base)] border border-[var(--border-mid)] rounded-lg text-[var(--text-primary)] text-sm placeholder-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none transition-colors"
                            />
                        </div>
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2.5 bg-[var(--accent)] text-[var(--on-accent)] rounded-lg font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                Signing in...
                            </>
                        ) : (
                            "Sign In"
                        )}
                    </button>

                    {/* Divider */}
                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-[var(--border-mid)]" />
                        </div>
                        <div className="relative flex justify-center text-xs">
                            <span className="px-2 bg-[var(--bg-panel)] text-[var(--text-faint)] font-mono">Don't have an account?</span>
                        </div>
                    </div>

                    {/* Sign Up Link */}
                    <Link
                        to="/auth/signup"
                        className="w-full py-2.5 border border-[var(--border-mid)] rounded-lg font-semibold text-sm transition-all hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] text-center block"
                    >
                        Create Account
                    </Link>
                </form>
            </div>
        </div>
    );
}
