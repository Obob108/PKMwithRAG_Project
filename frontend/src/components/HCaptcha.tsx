// Widget hCaptcha tối giản: tự nạp script của hCaptcha một lần, render vào một <div>, báo token qua onVerify.
// Token chỉ dùng được MỘT lần và hết hạn sau ~2 phút: gọi ref.reset() sau mỗi lần gửi thất bại.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

interface HCaptchaApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
}
declare global {
  interface Window {
    hcaptcha?: HCaptchaApi;
    __pkmHcaptchaReady?: () => void;
  }
}

let loader: Promise<HCaptchaApi> | null = null;

function loadHCaptcha(): Promise<HCaptchaApi> {
  if (window.hcaptcha) return Promise.resolve(window.hcaptcha);
  if (loader) return loader;
  loader = new Promise<HCaptchaApi>((resolve, reject) => {
    window.__pkmHcaptchaReady = () => resolve(window.hcaptcha as HCaptchaApi);
    const s = document.createElement("script");
    s.src = "https://js.hcaptcha.com/1/api.js?render=explicit&onload=__pkmHcaptchaReady&recaptchacompat=off";
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      loader = null;
      s.remove();
      reject(new Error("Không tải được hCaptcha"));
    };
    document.head.appendChild(s);
  });
  return loader;
}

export interface HCaptchaHandle {
  reset(): void;
}

interface Props {
  sitekey: string;
  theme?: "light" | "dark";
  onVerify: (token: string) => void;
  onExpire: () => void;
  onError?: (msg: string) => void;
}

const HCaptcha = forwardRef<HCaptchaHandle, Props>(function HCaptcha({ sitekey, theme = "light", onVerify, onExpire, onError }, ref) {
  const boxRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const cb = useRef({ onVerify, onExpire, onError });
  cb.current = { onVerify, onExpire, onError };

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetId.current !== null) window.hcaptcha?.reset(widgetId.current);
      cb.current.onExpire();
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    loadHCaptcha()
      .then((hc) => {
        if (cancelled || !boxRef.current) return;
        widgetId.current = hc.render(boxRef.current, {
          sitekey,
          theme,
          callback: (token: string) => cb.current.onVerify(token),
          "expired-callback": () => cb.current.onExpire(),
          "chalexpired-callback": () => cb.current.onExpire(),
          "error-callback": () => {
            cb.current.onExpire();
            cb.current.onError?.("Captcha gặp lỗi, hãy thử lại.");
          },
        });
      })
      .catch(() => cb.current.onError?.("Không tải được captcha. Kiểm tra kết nối mạng hoặc trình chặn quảng cáo."));
    return () => {
      cancelled = true;
      if (widgetId.current !== null) {
        try {
          window.hcaptcha?.remove(widgetId.current);
        } catch {
          // widget đã bị gỡ
        }
        widgetId.current = null;
      }
    };
  }, [sitekey, theme]);

  return <div className="captcha-box" ref={boxRef} />;
});

export default HCaptcha;
