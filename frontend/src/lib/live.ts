// Vòng lặp đồng bộ trực tiếp: bắt kịp sự kiện đã bỏ lỡ rồi nghe luồng SSE; mất mạng thì thử lại với độ trễ tăng dần.
import type { HttpApi } from "./api.ts";
import type { SyncEngine } from "./engine.ts";
import { ApiError } from "./types.ts";

export type LiveState = "connecting" | "live" | "offline";

export function startLive(engine: SyncEngine, api: HttpApi, onState: (s: LiveState) => void): { stop(): void; wake(): void } {
  const ctrl = new AbortController();
  let wakeFn: (() => void) | null = null;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        ctrl.signal.removeEventListener("abort", done);
        wakeFn = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      wakeFn = done;
      ctrl.signal.addEventListener("abort", done);
    });

  void (async () => {
    let delay = 1000;
    while (!ctrl.signal.aborted) {
      try {
        onState("connecting");
        await engine.catchUp();
        onState("live");
        delay = 1000;
        await api.streamEvents(engine.cursor ?? 0, (ev) => engine.handleEvent(ev), ctrl.signal);
        if (!ctrl.signal.aborted) await sleep(300); // máy chủ đóng luồng định kỳ: nối lại ngay
      } catch (e) {
        if (ctrl.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401) {
          engine.onUnauthorized?.();
          return;
        }
        onState("offline");
        await sleep(delay);
        delay = Math.min(delay * 2, 30000);
      }
    }
  })();

  return { stop: () => ctrl.abort(), wake: () => wakeFn?.() };
}
