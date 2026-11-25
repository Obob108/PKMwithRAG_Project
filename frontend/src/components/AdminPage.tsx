// Trang quản trị (bản tối thiểu): danh sách tài khoản, khóa / mở khóa, ghi chú lập chỉ mục lỗi.
// Quyền thật sự do máy chủ kiểm tra (require_admin → 403); trang này chỉ là giao diện.
import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../lib/api.ts";
import type { AdminUser, FailedNote, Session } from "../lib/api.ts";
import { ApiError, NetworkError } from "../lib/types.ts";
import { applyTheme, loadUi } from "../lib/ui.ts";

function errText(e: unknown): string {
  if (e instanceof ApiError) return e.detail;
  if (e instanceof NetworkError) return "Không kết nối được máy chủ";
  return String(e);
}

export default function AdminPage({ session, onLogout }: { session: Session; onLogout: (reason?: "user" | "expired") => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [failed, setFailed] = useState<FailedNote[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => applyTheme(loadUi().theme), []);

  const handle = useCallback((e: unknown) => {
    // 401: phiên hết hạn / bị thu hồi → về màn đăng nhập. 403: không còn quyền admin.
    if (e instanceof ApiError && e.status === 401) return onLogout("expired");
    setError(errText(e));
  }, [onLogout]);

  const reload = useCallback(async () => {
    setError("");
    try {
      const [u, f] = await Promise.all([
        adminApi.users("", session.token),
        adminApi.failedNotes("", session.token),
      ]);
      setUsers(u);
      setFailed(f);
    } catch (e) {
      handle(e);
    }
  }, [session.token, handle]);

  useEffect(() => { void reload(); }, [reload]);

  const toggle = async (u: AdminUser) => {
    const lock = u.is_active;
    if (lock && !window.confirm(`Khóa tài khoản “${u.username}”?\nNgười này sẽ bị đăng xuất ngay và không đăng nhập được cho tới khi mở khóa.`)) return;
    setBusyId(u.id);
    setError("");
    try {
      const r = await adminApi.setActive("", session.token, u.id, !lock);
      setUsers((list) => list?.map((x) => (x.id === u.id ? { ...x, is_active: r.is_active } : x)) ?? list);
    } catch (e) {
      handle(e);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-page">
      <header className="admin-header">
        <h1>Quản trị</h1>
        <span className="admin-who">{session.username} · admin</span>
        <button onClick={() => void reload()}>Tải lại</button>
        <button onClick={() => onLogout("user")}>Đăng xuất</button>
      </header>

      {error && <div className="admin-error" role="alert">{error}</div>}

      <section className="admin-section">
        <h2>Tài khoản {users && <span className="admin-count">({users.length})</span>}</h2>
        {users === null ? <p className="admin-muted">Đang tải…</p> : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ID</th><th>Tên đăng nhập</th><th>Email</th><th>Vai trò</th>
                  <th className="num">Ghi chú</th><th className="num">Lỗi</th><th>Ngày tạo</th><th>Trạng thái</th><th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={u.is_active ? "" : "locked"}>
                    <td>{u.id}</td>
                    <td>{u.username}</td>
                    <td>{u.email ?? <span className="admin-muted">—</span>}</td>
                    <td>{u.role === "admin" ? <b>admin</b> : "user"}</td>
                    <td className="num">{u.note_count}</td>
                    <td className="num">{u.failed_count || ""}</td>
                    <td>{u.created_at.slice(0, 10)}</td>
                    <td>{u.is_active ? <span className="admin-ok">Hoạt động</span> : <span className="admin-bad">Đã khóa</span>}</td>
                    <td>
                      {u.role !== "admin" && (
                        <button className={u.is_active ? "danger" : ""} disabled={busyId === u.id}
                                onClick={() => void toggle(u)}>
                          {u.is_active ? "Khóa" : "Mở khóa"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-section">
        <h2>Ghi chú lập chỉ mục lỗi {failed && <span className="admin-count">({failed.length})</span>}</h2>
        <p className="admin-muted">Chỉ hiện tiêu đề và thông báo lỗi; quản trị viên không xem được nội dung ghi chú.</p>
        {failed === null ? <p className="admin-muted">Đang tải…</p> : failed.length === 0 ? (
          <p className="admin-muted">Không có ghi chú nào bị lỗi.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Người dùng</th><th>Tiêu đề</th><th>Loại</th><th>Lỗi</th><th>Cập nhật</th></tr>
              </thead>
              <tbody>
                {failed.map((n) => (
                  <tr key={n.id}>
                    <td>{n.username}</td>
                    <td>{n.title}</td>
                    <td>{n.source}</td>
                    <td className="admin-err-cell">{n.error || <span className="admin-muted">(không có thông báo)</span>}</td>
                    <td>{n.updated_at.slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
