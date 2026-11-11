import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: gọi /api tới backend FastAPI (chạy `uvicorn app.main:app --port 8000` trong thư mục backend).
// Cho phép truy cập từ điện thoại cùng Wi-Fi: `npm run dev -- --host`, rồi mở http://<IP-máy-tính>:5173
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
