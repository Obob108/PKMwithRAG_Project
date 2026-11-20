// Bộ icon nét mảnh, bo tròn, kiểu vẽ tay cho hợp phong cách lo-fi (thay emoji: màu theo chữ, đổi theo theme).
import type { ReactNode } from "react";

export type IconName =
  | "new" | "search" | "graph" | "upload" | "chat" | "command" | "sync" | "settings"
  | "menu" | "panel" | "plus" | "folder" | "folderPlus" | "clock" | "note" | "pdf" | "leaf" | "tag";

const P: Record<IconName, ReactNode> = {
  // trang giấy gấp góc + dấu cộng
  new: (<>
    <path d="M6 3.5h7.5L18 8v11.2a1.3 1.3 0 0 1-1.3 1.3H6.3A1.3 1.3 0 0 1 5 19.2V4.8A1.3 1.3 0 0 1 6.3 3.5Z" />
    <path d="M13.5 3.6V8H18" />
    <path d="M11.5 11.2v5.6M8.7 14h5.6" />
  </>),
  // kính lúp
  search: (<>
    <circle cx="10.5" cy="10.5" r="5.8" />
    <path d="M15 15l4.6 4.6" />
    <path d="M8 8.6a3 3 0 0 1 2.4-1.4" />
  </>),
  // chòm sao: các nốt nối nhau
  graph: (<>
    <path d="M6 7.5l5.5 3M11.5 10.5l6.5-3.5M11.5 10.5l-1.8 7M11.5 10.5l6 6" />
    <circle cx="5.5" cy="7" r="2" /><circle cx="18.5" cy="6.5" r="1.7" />
    <circle cx="11.5" cy="10.5" r="2.3" /><circle cx="9.3" cy="18.2" r="1.6" /><circle cx="18" cy="17" r="1.9" />
  </>),
  // mũi tên lên khỏi khay
  upload: (<>
    <path d="M12 15.5V4.5M7.8 8.5 12 4.3l4.2 4.2" />
    <path d="M4.5 14.5v3.2a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3.2" />
  </>),
  // bong bóng thoại
  chat: (<>
    <path d="M4.5 11.2c0-3.7 3.4-6.5 7.5-6.5s7.5 2.8 7.5 6.5-3.4 6.4-7.5 6.4c-.9 0-1.8-.1-2.6-.4L5.6 19.3l1-3.3c-1.3-1.2-2.1-2.9-2.1-4.8Z" />
    <path d="M9 11.2h.01M12 11.2h.01M15 11.2h.01" strokeWidth="2.4" />
  </>),
  // ngôi sao lấp lánh (bảng lệnh)
  command: (<>
    <path d="M12 3.5c.6 3.9 2.3 5.6 6.5 6.5-4.2.9-5.9 2.6-6.5 6.5-.6-3.9-2.3-5.6-6.5-6.5 4.2-.9 5.9-2.6 6.5-6.5Z" />
    <path d="M18.5 15.5c.2 1.3.8 1.9 2 2.1-1.2.2-1.8.8-2 2.1-.2-1.3-.8-1.9-2-2.1 1.2-.2 1.8-.8 2-2.1Z" />
  </>),
  // hai mũi tên vòng
  sync: (<>
    <path d="M18.8 10.2A7 7 0 0 0 6.4 7.1L5 8.6" /><path d="M4.8 4.8v3.9h3.9" />
    <path d="M5.2 13.8a7 7 0 0 0 12.4 3.1l1.4-1.5" /><path d="M19.2 19.2v-3.9h-3.9" />
  </>),
  // bánh răng tròn như bông hoa
  settings: (<>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.6v2.2M12 18.2v2.2M3.6 12h2.2M18.2 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
    <circle cx="12" cy="12" r="6.2" />
  </>),
  menu: (<><path d="M4.5 7h15M4.5 12h11M4.5 17h13" /></>),
  // khung có cột bên phải (thanh bên phải)
  panel: (<>
    <rect x="3.8" y="5" width="16.4" height="14" rx="2.2" />
    <path d="M14.5 5.2v13.6M16.8 9h1.4M16.8 12h1.4" />
  </>),
  plus: (<><path d="M12 5.5v13M5.5 12h13" /></>),
  folder: (<>
    <path d="M3.8 7.2a1.7 1.7 0 0 1 1.7-1.7h3.7l2 2.2h7.3a1.7 1.7 0 0 1 1.7 1.7v7.9a1.7 1.7 0 0 1-1.7 1.7H5.5a1.7 1.7 0 0 1-1.7-1.7Z" />
  </>),
  folderPlus: (<>
    <path d="M3.8 7.2a1.7 1.7 0 0 1 1.7-1.7h3.7l2 2.2h7.3a1.7 1.7 0 0 1 1.7 1.7v7.9a1.7 1.7 0 0 1-1.7 1.7H5.5a1.7 1.7 0 0 1-1.7-1.7Z" />
    <path d="M12 10.8v5M9.5 13.3h5" />
  </>),
  clock: (<><circle cx="12" cy="12" r="7.5" /><path d="M12 7.8V12l2.8 1.8" /></>),
  note: (<>
    <path d="M6.5 3.8h7L17.5 8v11a1.2 1.2 0 0 1-1.2 1.2H6.5A1.2 1.2 0 0 1 5.3 19V5a1.2 1.2 0 0 1 1.2-1.2Z" />
    <path d="M13.4 3.9V8h4M8.3 12h6.4M8.3 15.2h4.6" />
  </>),
  pdf: (<>
    <path d="M6.5 3.8h7L17.5 8v11a1.2 1.2 0 0 1-1.2 1.2H6.5A1.2 1.2 0 0 1 5.3 19V5a1.2 1.2 0 0 1 1.2-1.2Z" />
    <path d="M13.4 3.9V8h4" /><path d="M8.2 16.5c1.6-2.3 2.6-4.6 2.4-6 1 2.2 2.4 3.6 4.4 4.1-2.4 0-4.8.6-6.8 1.9Z" />
  </>),
  // lá cây
  leaf: (<>
    <path d="M5 19c0-8 5-13.5 14-14-.4 9-5.8 14-14 14Z" /><path d="M5 19c3-4 6-7 10.5-10" />
  </>),
  tag: (<>
    <path d="M4.2 11.6V5.4a1.2 1.2 0 0 1 1.2-1.2h6.2l8.2 8.2a1.3 1.3 0 0 1 0 1.8l-6.2 6.2a1.3 1.3 0 0 1-1.8 0Z" />
    <circle cx="8.4" cy="8.4" r="1.3" />
  </>),
};

export function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={"icon " + className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {P[name]}
    </svg>
  );
}
