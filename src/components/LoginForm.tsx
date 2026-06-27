import React, { useState } from "react";
import { Shield, Sparkles, User, Lock, Activity, Eye, EyeOff } from "lucide-react";
import { login } from "../frontend/api/authApi";

interface LoginFormProps {
  onLoginSuccess: (user: { name: string; role: string; token: string }) => void;
  onProceedAsGuest: () => void | Promise<void>;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onLoginSuccess, onProceedAsGuest }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res: any = await login(username.trim(), password);

      if (res.success) {
        onLoginSuccess({
          name: res.name,
          role: res.role,
          token: res.token
        });
      }
    } catch (err: any) {
      console.error("Login failed:", err);
      setError(err.response?.data?.error || "Incorrect username or password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async () => {
    setLoading(true);
    setError(null);
    try {
      await onProceedAsGuest();
    } catch (err: any) {
      console.error("Guest session failed:", err);
      setError(err.response?.data?.error || "Could not start a guest session. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 relative overflow-hidden" id="login_screen">
      {/* Background blobs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#00ADC6]/5 rounded-full blur-3xl -translate-y-1/2 -translate-x-1/2 pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl translate-y-1/2 translate-x-1/2 pointer-events-none" />

      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-zinc-100 overflow-hidden relative z-10">
        {/* Header decoration */}
        <div className="bg-gradient-to-r from-[#00ADC6] to-[#047E8F] px-8 py-10 text-white relative">
          <div className="absolute top-4 right-4 text-white/10">
            <Activity size={80} strokeWidth={1} />
          </div>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center shadow-lg">
              <Shield className="text-white" size={20} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">SynoHub</h1>
              <p className="text-[10px] text-white/70 font-semibold uppercase tracking-widest">Fleet Intelligence</p>
            </div>
          </div>
          <h2 className="text-xl font-semibold mt-4">Dubai Operations Portal</h2>
          <p className="text-xs text-white/80 mt-1">Authenticate to access database records and analytics.</p>
        </div>

        <div className="p-8">
          {error && (
            <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-xs font-semibold flex flex-col gap-1">
              <span>⚠️ Log In Failed</span>
              <span className="text-rose-500/80 font-normal">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5">Username / Employee Name</label>
              <div className="relative">
                <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  required
                  type="text"
                  placeholder="e.g. admin or Celine"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl py-3 pl-10 pr-4 text-xs focus:outline-none focus:bg-white focus:border-[#00ADC6] transition-all font-medium text-zinc-800"
                  id="login_username_input"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5">Security Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  required
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-zinc-50 border border-zinc-200 rounded-xl py-3 pl-10 pr-10 text-xs focus:outline-none focus:bg-white focus:border-[#00ADC6] transition-all font-medium text-zinc-800"
                  id="login_password_input"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 focus:outline-none"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-[#00ADC6] to-[#018698] hover:shadow-lg hover:shadow-[#00ADC6]/20 text-white rounded-xl py-3.5 text-xs font-bold transition-all flex items-center justify-center gap-2 mt-2"
              id="login_submit_btn"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>🔒 Authorized Log In</>
              )}
            </button>
          </form>

          {/* Proceed as guest */}
          <div className="relative my-6 flex items-center justify-center">
            <div className="absolute inset-x-0 h-px bg-zinc-200/60" />
            <span className="relative bg-white px-3 text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Public Client Access</span>
          </div>

          <button
            type="button"
            onClick={handleGuest}
            disabled={loading}
            className="w-full border border-zinc-200 hover:bg-zinc-50 text-zinc-600 rounded-xl py-3 text-xs font-bold transition-all flex items-center justify-center gap-2"
            id="login_guest_btn"
          >
            🚀 Submit Task / Request as Guest
          </button>

          {/* Login guidance */}
          <div className="mt-8 pt-6 border-t border-zinc-100">
            <div className="mt-5 p-3.5 bg-zinc-50 rounded-xl border border-zinc-150 text-[11px] text-zinc-600 space-y-2">
              <span className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Secure Access</span>
              <div className="space-y-1.5">
                <p className="leading-relaxed">
                  Staff and administrator passwords are managed on the server. Guests receive an isolated temporary session for their own requests.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
