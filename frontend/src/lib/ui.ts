// Trạng thái giao diện lưu trong localStorage (giao diện sáng/tối, sidebar, chế độ soạn thảo...).
export type Mode = "edit" | "read" | "split";
export type LeftTab = "files" | "search" | "tags";
export type RightTab = "links" | "outline" | "chat";

export interface UiState {
  theme: "dark" | "light";
  fontSize: number;
  mode: Mode;
  leftOpen: boolean;
  rightOpen: boolean;
  leftTab: LeftTab;
  rightTab: RightTab;
  leftW: number;
  rightW: number;
  chatUseGraph: boolean;
}

const KEY = "pkm.ui";
const narrow = (): boolean => typeof window !== "undefined" && window.innerWidth < 800;

export function defaultUi(): UiState {
  return {
    theme: "dark", fontSize: 16, mode: "edit", leftOpen: !narrow(), rightOpen: false,
    leftTab: "files", rightTab: "links", leftW: 270, rightW: 300, chatUseGraph: false,
  };
}

export function loadUi(): UiState {
  try {
    const raw = localStorage.getItem(KEY);
    return { ...defaultUi(), ...(raw ? (JSON.parse(raw) as Partial<UiState>) : {}) };
  } catch {
    return defaultUi();
  }
}

export function saveUi(ui: UiState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ui));
  } catch {
    // bộ nhớ đầy hoặc bị chặn: bỏ qua
  }
}

export function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
}
