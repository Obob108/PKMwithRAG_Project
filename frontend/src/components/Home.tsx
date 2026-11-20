// Trang chủ phong cách lo-fi / cottagecore: cửa sổ có cây, tách trà, sách; sáng = buổi sáng ấm nắng, tối = đêm lo-fi.
// Hình minh họa vẽ bằng SVG thuần, màu lấy từ biến CSS nên tự đổi theo giao diện sáng/tối.
import { useMemo } from "react";
import type { Folder, LocalNote } from "../lib/types.ts";
import { avatarColor, initialOf } from "./Chrome.tsx";

interface Props {
  username: string;
  notes: LocalNote[];
  folders: Folder[];
  tagCount: number;
  theme: "dark" | "light";
  onNew: () => void;
  onSwitcher: () => void;
  onGraph: () => void;
  onUpload: () => void;
  onChat: () => void;
  onOpenKey: (key: string) => void;
}

const TIPS = [
  "Viết một ý nhỏ mỗi ngày, kho tri thức sẽ lớn lên từ những mẩu như thế.",
  "Không cần hoàn hảo: cứ ghi trước, sắp xếp sau.",
  "Mở Graph view xem hôm nay các ý tưởng của bạn đang nối với nhau ra sao.",
  "Một liên kết [[ ]] nhỏ hôm nay giúp bạn của tương lai tìm lại đường cũ.",
  "Duyệt gợi ý liên kết bằng ✓ / ✗ để graph chỉ giữ những gì có ý nghĩa với bạn.",
  "Đặt câu hỏi ở tab Hỏi đáp: câu trả lời luôn kèm ghi chú nguồn.",
  "Pha một tách trà, rồi đọc lại một ghi chú cũ. Biết đâu lại nảy ra ý mới.",
];

function greeting(h: number): string {
  if (h < 5) return "Khuya rồi";
  if (h < 11) return "Chào buổi sáng";
  if (h < 13) return "Chào buổi trưa";
  if (h < 18) return "Chào buổi chiều";
  return "Chào buổi tối";
}

function ago(ms: number, now: number): string {
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return new Date(ms).toLocaleDateString("vi-VN");
}

function snippet(md: string): string {
  return md.replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/gm, "").replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1").replace(/[*_`>#~]/g, "")
    .replace(/\s+/g, " ").trim().slice(0, 90);
}

export default function Home(p: Props) {
  const now = Date.now();
  const d = new Date(now);
  const dayIndex = Math.floor(now / 86400000);
  const tip = TIPS[dayIndex % TIPS.length];
  const recent = useMemo(
    () => p.notes.filter((n) => !n.deleted).sort((a, b) => b.updated_ms - a.updated_ms).slice(0, 5),
    [p.notes],
  );
  const folderName = useMemo(() => new Map(p.folders.map((f) => [f.id, f.name])), [p.folders]);
  const dateText = d.toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className={"home " + (p.theme === "dark" ? "night" : "day")}>
      <div className="home-inner">
        <Scene />

        <header className="home-hello">
          <span className="avatar big" style={{ background: avatarColor(p.username) }}>{initialOf(p.username)}</span>
          <div>
            <h1>{greeting(d.getHours())}, {p.username}</h1>
            <div className="home-date">{dateText.charAt(0).toUpperCase() + dateText.slice(1)} · Hôm nay bạn muốn ghi lại điều gì?</div>
          </div>
        </header>

        <div className="home-stats">
          <span>🌿 {p.notes.length} ghi chú</span>
          <span>📁 {p.folders.length} thư mục</span>
          <span>🏷 {p.tagCount} thẻ</span>
        </div>

        <div className="home-actions">
          <button className="paper-card primary-card" onClick={p.onNew}>
            <span className="pc-icon">✎</span><span className="pc-title">Ghi chú mới</span><kbd>Ctrl+N</kbd>
          </button>
          <button className="paper-card" onClick={p.onSwitcher}>
            <span className="pc-icon">🔎</span><span className="pc-title">Mở nhanh</span><kbd>Ctrl+O</kbd>
          </button>
          <button className="paper-card" onClick={p.onGraph}>
            <span className="pc-icon">🕸</span><span className="pc-title">Graph view</span><kbd>Ctrl+G</kbd>
          </button>
          <button className="paper-card" onClick={p.onChat}>
            <span className="pc-icon">💬</span><span className="pc-title">Hỏi đáp</span>
          </button>
          <button className="paper-card" onClick={p.onUpload}>
            <span className="pc-icon">⬆</span><span className="pc-title">Tải lên .md / .pdf</span>
          </button>
        </div>

        <div className="home-columns">
          <section className="home-recent">
            <h2>Ghi chú gần đây</h2>
            {recent.length === 0 && <div className="home-empty">Chưa có ghi chú nào. Bắt đầu bằng một dòng thôi cũng được.</div>}
            <ul>
              {recent.map((n) => (
                <li key={n.key}>
                  <button className="recent-card" onClick={() => p.onOpenKey(n.key)}>
                    <span className="rc-title">{n.source === "pdf" ? "📕" : "📄"} {n.title || "Chưa đặt tên"}</span>
                    <span className="rc-meta">
                      {n.folder_id != null && folderName.has(n.folder_id) ? `📁 ${folderName.get(n.folder_id)} · ` : ""}{ago(n.updated_ms, now)}
                    </span>
                    {snippet(n.content) && <span className="rc-snippet">{snippet(n.content)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <aside className="home-note">
            <div className="tape" aria-hidden />
            <h2>Mẩu nhỏ hôm nay</h2>
            <p>{tip}</p>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** Cửa sổ nhỏ: rèm, dây đèn, chậu trầu bà rủ lá, chậu cúc, chồng sách, tách trà bốc hơi, nấm nhỏ. */
function Scene() {
  return (
    <svg className="home-scene" viewBox="0 0 420 250" role="img" aria-label="Khung cửa sổ với cây, sách và tách trà">
      <defs>
        <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="sky-top" />
          <stop offset="1" className="sky-bottom" />
        </linearGradient>
        <clipPath id="hs-window"><path d="M130 200 V80 a80 62 0 0 1 160 0 V200 Z" /></clipPath>
      </defs>

      {/* bầu trời trong khung cửa */}
      <g clipPath="url(#hs-window)">
        <rect x="120" y="10" width="180" height="200" fill="url(#hs-sky)" />
        <g className="only-day">
          <circle cx="250" cy="70" r="22" className="sun" />
          <g className="cloud drift">
            <ellipse cx="170" cy="95" rx="22" ry="9" /><ellipse cx="188" cy="88" rx="15" ry="10" /><ellipse cx="200" cy="96" rx="16" ry="8" />
          </g>
          <path d="M130 185 Q170 160 210 178 T290 170 V200 H130 Z" className="hill" />
        </g>
        <g className="only-night">
          <path d="M262 52 a20 20 0 1 0 14 34 a16 16 0 1 1 -14 -34 Z" className="moon" />
          {[[160, 60], [190, 40], [215, 75], [150, 110], [240, 115], [275, 130], [175, 140]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={i % 3 ? 1.3 : 1.9} className="star" style={{ animationDelay: `${i * 0.7}s` }} />
          ))}
          <path d="M130 185 Q170 160 210 178 T290 170 V200 H130 Z" className="hill" />
        </g>
      </g>

      {/* khung + song cửa */}
      <path d="M130 200 V80 a80 62 0 0 1 160 0 V200" className="frame" fill="none" />
      <line x1="210" y1="18" x2="210" y2="200" className="mullion" />
      <line x1="130" y1="120" x2="290" y2="120" className="mullion" />

      {/* dây đèn */}
      <path d="M104 30 Q210 70 316 30" className="wire" fill="none" />
      {[[124, 38], [150, 47], [178, 53], [210, 55], [242, 53], [270, 47], [296, 38]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y + 5} r="3.2" className="bulb" style={{ animationDelay: `${i * 0.45}s` }} />
      ))}

      {/* rèm */}
      <path d="M100 14 H150 C140 70 152 130 136 206 H100 Z" className="curtain" />
      <path d="M320 14 H270 C280 70 268 130 284 206 H320 Z" className="curtain" />
      <path d="M96 12 H324" className="rod" />

      {/* bậu cửa */}
      <rect x="92" y="200" width="236" height="12" rx="3" className="sill" />
      <rect x="100" y="212" width="220" height="6" rx="2" className="sill-shadow" />

      {/* chậu trầu bà rủ lá */}
      <g className="sway" style={{ transformOrigin: "128px 186px" }}>
        <path d="M112 186 C100 200 98 214 104 232" className="vine" fill="none" />
        {[[104, 200], [99, 212], [103, 226]].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="5" ry="3.3" className="leaf" transform={`rotate(${-30 + i * 25} ${x} ${y})`} />)}
        <ellipse cx="120" cy="170" rx="8" ry="5" className="leaf" transform="rotate(-35 120 170)" />
        <ellipse cx="136" cy="166" rx="8" ry="5" className="leaf" transform="rotate(30 136 166)" />
        <ellipse cx="128" cy="160" rx="7" ry="4.5" className="leaf" transform="rotate(-80 128 160)" />
      </g>
      <path d="M112 178 H144 L140 200 H116 Z" className="pot" />

      {/* chậu cúc nhỏ */}
      <g className="sway slow" style={{ transformOrigin: "170px 190px" }}>
        <line x1="166" y1="188" x2="163" y2="170" className="stem" /><line x1="174" y1="188" x2="178" y2="166" className="stem" />
        {[[163, 168], [178, 164]].map(([x, y], i) => (
          <g key={i}>
            {[0, 60, 120, 180, 240, 300].map((a) => (
              <ellipse key={a} cx={x} cy={y - 4} rx="2" ry="4" className="petal" transform={`rotate(${a} ${x} ${y})`} />
            ))}
            <circle cx={x} cy={y} r="2.2" className="flower-heart" />
          </g>
        ))}
      </g>
      <path d="M160 186 H182 L179 200 H163 Z" className="pot small" />

      {/* chồng sách */}
      <rect x="236" y="190" width="46" height="10" rx="1.5" className="book b1" />
      <rect x="240" y="181" width="40" height="9" rx="1.5" className="book b2" />
      <rect x="234" y="172" width="44" height="9" rx="1.5" className="book b3" />

      {/* tách trà + hơi */}
      <g className="steam">
        <path d="M300 168 c-5 -8 5 -12 0 -22" /><path d="M308 166 c-5 -8 5 -12 0 -22" />
      </g>
      <path d="M292 178 H318 V192 a8 8 0 0 1 -8 8 H300 a8 8 0 0 1 -8 -8 Z" className="cup" />
      <path d="M318 182 a5 5 0 0 1 0 10" className="cup-handle" fill="none" />

      {/* nấm nhỏ */}
      <path d="M200 192 h8 v8 h-8 z" className="mush-stem" />
      <path d="M194 193 a10 8 0 0 1 20 0 Z" className="mush-cap" />
      <circle cx="200" cy="189" r="1.4" className="mush-dot" /><circle cx="207" cy="187" r="1.1" className="mush-dot" />
    </svg>
  );
}
