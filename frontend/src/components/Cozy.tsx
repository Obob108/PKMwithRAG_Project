// Hình trang trí nhỏ phong cách lo-fi cho thanh bên (SVG tự vẽ, màu theo biến CSS).

/** Chậu cây nhỏ ở góc dưới thanh bên trái (chỉ để trang trí, không bắt chuột). */
export function PlantCorner() {
  return (
    <svg className="cozy-plant" viewBox="0 0 120 90" aria-hidden>
      <path d="M8 86 H112" className="cz-shelf" />
      {/* chậu trầu bà */}
      <g className="cz-sway" style={{ transformOrigin: "34px 64px" }}>
        <path d="M24 64 C14 72 12 80 16 90" className="cz-vine" fill="none" />
        <ellipse cx="16" cy="76" rx="4.5" ry="3" className="cz-leaf" transform="rotate(-30 16 76)" />
        <ellipse cx="14" cy="86" rx="4.5" ry="3" className="cz-leaf" transform="rotate(10 14 86)" />
        <ellipse cx="26" cy="50" rx="8" ry="5" className="cz-leaf" transform="rotate(-40 26 50)" />
        <ellipse cx="42" cy="48" rx="8" ry="5" className="cz-leaf" transform="rotate(35 42 48)" />
        <ellipse cx="34" cy="40" rx="7" ry="4.5" className="cz-leaf" transform="rotate(-85 34 40)" />
      </g>
      <path d="M20 58 H48 L44 84 H24 Z" className="cz-pot" />
      {/* chồng sách + tách trà */}
      <rect x="62" y="76" width="34" height="8" rx="1.5" className="cz-book a" />
      <rect x="65" y="69" width="30" height="7" rx="1.5" className="cz-book b" />
      <g className="cz-steam"><path d="M84 58 c-4 -6 4 -9 0 -16" /><path d="M90 57 c-4 -6 4 -9 0 -16" /></g>
      <path d="M78 62 H96 V68 a6 6 0 0 1 -6 6 H84 a6 6 0 0 1 -6 -6 Z" className="cz-cup" />
    </svg>
  );
}

/** Ô trống dễ thương: tách trà + lời nhắn. */
export function CozyEmpty({ text }: { text: string }) {
  return (
    <div className="cozy-empty">
      <svg viewBox="0 0 64 48" aria-hidden>
        <g className="cz-steam"><path d="M26 20 c-4 -6 4 -9 0 -16" /><path d="M34 19 c-4 -6 4 -9 0 -16" /></g>
        <path d="M16 24 H44 V34 a8 8 0 0 1 -8 8 H24 a8 8 0 0 1 -8 -8 Z" className="cz-cup" />
        <path d="M44 27 a5 5 0 0 1 0 10" className="cz-handle" fill="none" />
        <path d="M10 44 H50" className="cz-shelf" />
      </svg>
      <span>{text}</span>
    </div>
  );
}
