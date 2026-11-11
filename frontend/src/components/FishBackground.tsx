// Đàn cá bơi ngang nền trang đăng nhập (chỉ trang trí: không bắt chuột, tắt khi người dùng chọn "giảm chuyển động").
import { useMemo } from "react";
import type { CSSProperties } from "react";

const COLORS = ["#ff8a5c", "#ffd166", "#f4978e", "#7bdff2", "#ffffff", "#c8b6ff"];

interface Fish {
  top: number;      // % chiều cao
  size: number;     // px
  duration: number; // giây để bơi hết màn hình
  delay: number;    // giây (âm = đã bơi được một đoạn khi mở trang)
  left: boolean;    // bơi từ phải sang trái
  color: string;
  bob: number;      // giây cho một nhịp nhấp nhô
  opacity: number;
}

function makeFish(count: number): Fish[] {
  return Array.from({ length: count }, () => {
    const duration = 14 + Math.random() * 18;
    return {
      top: 4 + Math.random() * 88,
      size: 26 + Math.random() * 46,
      duration,
      delay: -Math.random() * duration,
      left: Math.random() < 0.5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      bob: 2 + Math.random() * 2.5,
      opacity: 0.55 + Math.random() * 0.4,
    };
  });
}

function FishShape({ color }: { color: string }) {
  // Cá quay mặt sang phải; bơi sang trái thì lật bằng CSS.
  return (
    <svg viewBox="0 0 64 40" width="100%" height="100%" aria-hidden="true">
      <path className="fish-tail" d="M14 20 L0 6 L4 20 L0 34 Z" fill={color} />
      <ellipse cx="34" cy="20" rx="24" ry="14" fill={color} />
      <path d="M30 7 Q38 0 44 8 Z" fill={color} opacity="0.85" />
      <path d="M24 10 Q20 20 24 30" stroke="rgba(0,0,0,0.12)" strokeWidth="2" fill="none" />
      <circle cx="47" cy="16" r="3.2" fill="#1d2a33" />
      <circle cx="48" cy="15" r="1" fill="#fff" />
    </svg>
  );
}

export default function FishBackground({ count = 12 }: { count?: number }) {
  const fish = useMemo(() => makeFish(count), [count]);
  return (
    <div className="fish-tank" aria-hidden="true">
      {fish.map((f, i) => (
        <div
          key={i}
          className={"fish" + (f.left ? " to-left" : "")}
          style={{
            top: `${f.top}%`,
            width: f.size,
            height: f.size * 0.62,
            opacity: f.opacity,
            animationDuration: `${f.duration}s`,
            animationDelay: `${f.delay}s`,
            "--bob": `${f.bob}s`,
          } as CSSProperties}
        >
          <div className="fish-body"><FishShape color={f.color} /></div>
        </div>
      ))}
      {Array.from({ length: 10 }, (_, i) => (
        <span key={`b${i}`} className="bubble" style={{
          left: `${5 + Math.random() * 90}%`,
          width: 6 + Math.random() * 10, height: 6 + Math.random() * 10,
          animationDuration: `${8 + Math.random() * 10}s`,
          animationDelay: `${-Math.random() * 15}s`,
        }} />
      ))}
    </div>
  );
}
