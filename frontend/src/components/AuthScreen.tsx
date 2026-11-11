import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getConfig, login, register } from "../lib/api.ts";
import type { PublicConfig, Session } from "../lib/api.ts";
import { ApiError, NetworkError } from "../lib/types.ts";

export default function AuthScreen({ onLogin }: { onLogin: (s: Session) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [cfg, setCfg] = useState<PublicConfig>({ allow_registration: true, invite_required: false });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getConfig().then(setCfg).catch(() => undefined);
  }, []);

  const switchMode = (m: "login" | "register") => {
    setMode(m);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "register") {
      if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return setError("Tên đăng nhập 3–32 ký tự: chữ, số, _ . -");
      if (password.length < 8) return setError("Mật khẩu cần ít nhất 8 ký tự");
      if (password !== confirm) return setError("Hai mật khẩu không khớp");
    }
    setBusy(true);
    try {
      const s = mode === "login" ? await login("", username.trim(), password) : await register("", username.trim(), password, invite.trim());
      onLogin(s);
    } catch (err) {
      if (err instanceof ApiError) setError(err.detail || "Có lỗi xảy ra");
      else if (err instanceof NetworkError) setError("Không kết nối được máy chủ. Kiểm tra mạng hoặc backend đang chạy.");
      else setError("Có lỗi không xác định");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1>🧠 Tri thức cá nhân</h1>
        <p className="muted">Ghi chú Markdown, tự liên kết ngữ nghĩa, hỏi đáp trên chính ghi chú của bạn.</p>
        {cfg.allow_registration && (
          <div className="auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>Đăng nhập</button>
            <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>Đăng ký</button>
          </div>
        )}
        <label>Tên đăng nhập
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label>Mật khẩu
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} required />
        </label>
        {mode === "register" && (
          <>
            <label>Nhập lại mật khẩu
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </label>
            {cfg.invite_required && (
              <label>Mã mời
                <input value={invite} onChange={(e) => setInvite(e.target.value)} required />
              </label>
            )}
          </>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}
        </button>
        {!cfg.allow_registration && <p className="muted small">Máy chủ đang tắt đăng ký. Hãy nhờ quản trị viên tạo tài khoản.</p>}
      </form>
    </div>
  );
}
