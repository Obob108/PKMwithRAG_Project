import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import HCaptcha from "./HCaptcha.tsx";
import type { HCaptchaHandle } from "./HCaptcha.tsx";
import { forgotPassword, getConfig, isGmail, login, register, resetPassword } from "../lib/api.ts";
import type { PublicConfig, Session } from "../lib/api.ts";
import { ApiError, NetworkError } from "../lib/types.ts";
import FishBackground from "./FishBackground.tsx";
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

type Mode = "login" | "register" | "forgot";
// Quên mật khẩu gồm 2 bước: "email" = xin mã OTP gửi về Gmail; "code" = nhập mã + mật khẩu mới.
type ForgotStep = "email" | "code";

export default function AuthScreen({ onLogin, onDemo, initialMode = "login" }: {
  onLogin: (s: Session) => void;
  onDemo?: () => void; // quay lại bản demo (khách chưa có tài khoản)
  initialMode?: "login" | "register";
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [cfg, setCfg] = useState<PublicConfig>({ allow_registration: true, invite_required: false, hcaptcha_sitekey: null });
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<ForgotStep>("email");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [invite, setInvite] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<HCaptchaHandle>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getConfig().then(setCfg).catch(() => undefined);
  }, []);

  const captchaOn = !!cfg.hcaptcha_sitekey;
  const canSubmit = !busy && (!captchaOn || !!captchaToken);

  const switchMode = (m: Mode) => {
    setMode(m);
    setStep("email");
    setCode("");
    setError(null);
    setNotice(null);
    setPassword("");
    setConfirm("");
  };

  const errorText = (err: unknown) => {
    if (err instanceof ApiError) return err.detail || "Có lỗi xảy ra";
    if (err instanceof NetworkError) return "Không kết nối được máy chủ. Kiểm tra mạng hoặc backend đang chạy.";
    return "Có lỗi không xác định";
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (mode === "register" && !/^[A-Za-z0-9_.-]{3,32}$/.test(username.trim())) return setError("Tên đăng nhập 3–32 ký tự: chữ, số, _ . -");
    const askingCode = mode === "forgot" && step === "email";
    if (mode !== "login" && !isGmail(email)) return setError("Email phải đúng định dạng Gmail (vd: ten@gmail.com)");
    if (mode === "forgot" && step === "code" && !/^\d{6}$/.test(code.trim())) return setError("Mã xác nhận gồm 6 chữ số");
    if (mode !== "login" && !askingCode) {
      if (password.length < 8) return setError("Mật khẩu cần ít nhất 8 ký tự");
      if (password !== confirm) return setError("Hai mật khẩu không khớp");
    }
    if (captchaOn && !captchaToken) return setError("Vui lòng hoàn thành captcha");
    setBusy(true);
    const token = captchaToken ?? undefined;
    try {
      if (askingCode) {
        // Bước 1: máy chủ luôn trả cùng một thông báo, dù email có tài khoản hay không.
        setNotice(await forgotPassword("", email.trim(), token));
        setStep("code");
        setCode("");
      } else if (mode === "forgot") {
        const { username: u } = await resetPassword("", email.trim(), code.trim(), password, token);
        // Đổi xong: quay về đăng nhập, điền sẵn tên đăng nhập, người dùng nhập mật khẩu mới.
        setMode("login");
        setStep("email");
        setCode("");
        setUsername(u);
        setEmail("");
        setPassword("");
        setConfirm("");
        setNotice(`Đã đổi mật khẩu cho tài khoản "${u}". Hãy đăng nhập bằng mật khẩu mới.`);
      } else {
        const s = mode === "login"
          ? await login("", username.trim(), password, token)
          : await register("", username.trim(), email.trim(), password, invite.trim(), token);
        onLogin(s);
      }
    } catch (err) {
      setError(errorText(err));
      if (mode === "forgot" && step === "code") setCode(""); // mã sai/hết hạn: nhập lại mã, giữ email
    } finally {
      setBusy(false);
      captchaRef.current?.reset(); // token captcha chỉ dùng được một lần
      setCaptchaToken(null);
    }
  };

  const pwToggle = (
    <button type="button" className="pw-toggle" onClick={() => setShowPw(!showPw)}
            aria-label={showPw ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={showPw}
            title={showPw ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
      <EyeIcon off={showPw} />
    </button>
  );

  const submitLabel = mode === "login" ? "Đăng nhập" : mode === "register" ? "Tạo tài khoản"
    : step === "email" ? "Gửi mã xác nhận" : "Đặt lại mật khẩu";
  const askPassword = mode !== "forgot" || step === "code";

  return (
    <div className="auth-wrap">
      <FishBackground />
      <form className="auth-card" onSubmit={submit}>
        <h1>Read. Feel. Write.</h1>
        <p className="muted">{mode === "forgot" ? "Đặt lại mật khẩu" : "Mừng bạn về nhà"}</p>
        {cfg.allow_registration && mode !== "forgot" && (
          <div className="auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>Đăng nhập</button>
            <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>Đăng ký</button>
          </div>
        )}
        {mode !== "forgot" && (
          <label>Tên đăng nhập
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
          </label>
        )}
        {mode !== "login" && (
          <label>{mode === "forgot" ? "Email của tài khoản" : "Email (Gmail)"}
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
                   placeholder="ten@gmail.com" autoFocus={mode === "forgot"} required
                   readOnly={mode === "forgot" && step === "code"} />
          </label>
        )}
        {mode === "forgot" && step === "code" && (
          <label>Mã xác nhận (6 số, gửi tới Gmail)
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                   inputMode="numeric" autoComplete="one-time-code" placeholder="123456" autoFocus required />
          </label>
        )}
        {askPassword && (
        <label>{mode === "forgot" ? "Mật khẩu mới" : "Mật khẩu"}
          <span className="pw-field">
            <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                   autoComplete={mode === "login" ? "current-password" : "new-password"} required />
            {pwToggle}
          </span>
        </label>
        )}
        {mode !== "login" && askPassword && (
          <label>{mode === "forgot" ? "Nhập lại mật khẩu mới" : "Xác nhận mật khẩu"}
            <input type={showPw ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </label>
        )}
        {mode === "register" && cfg.invite_required && (
          <label>Mã mời
            <input value={invite} onChange={(e) => setInvite(e.target.value)} required />
          </label>
        )}
        {mode === "login" && (
          <button type="button" className="auth-link auth-forgot" onClick={() => switchMode("forgot")}>Quên mật khẩu?</button>
        )}
        {captchaOn && (
          <HCaptcha ref={captchaRef} sitekey={cfg.hcaptcha_sitekey as string}
                    onVerify={(t) => { setCaptchaToken(t); setError(null); }}
                    onExpire={() => setCaptchaToken(null)}
                    onError={setError} />
        )}
        {notice && <div className="form-notice" role="status">{notice}</div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary" type="submit" disabled={!canSubmit}
                title={captchaOn && !captchaToken ? "Hoàn thành captcha trước" : undefined}>
          {busy ? "Đang xử lý…" : submitLabel}
        </button>
        {mode === "forgot" && step === "code" && (
          <button type="button" className="auth-link" onClick={() => { setStep("email"); setCode(""); setError(null); setNotice(null); }}>
            Chưa nhận được mã? Gửi lại hoặc đổi email
          </button>
        )}
        {mode === "forgot" && (
          <button type="button" className="auth-link" onClick={() => switchMode("login")}>← Quay lại đăng nhập</button>
        )}
        {onDemo && mode !== "forgot" && (
          <button type="button" className="auth-link" onClick={onDemo}>← Xem bản demo, không cần tài khoản</button>
        )}
        {!cfg.allow_registration && mode !== "forgot" && <p className="muted small">Máy chủ đang tắt đăng ký. Hãy nhờ quản trị viên tạo tài khoản.</p>}
      </form>
    </div>
  );
}
