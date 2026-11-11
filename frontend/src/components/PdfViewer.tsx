import { useEffect, useState } from "react";
import type { HttpApi } from "../lib/api.ts";
import { ApiError } from "../lib/types.ts";
import type { LocalNote } from "../lib/types.ts";

interface Props {
  note: LocalNote;
  api: HttpApi;
  onOpenNote: () => void;
}

export default function PdfViewer({ note, api, onOpenNote }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (note.id === null) {
      setError("Ghi chú chưa được đồng bộ lên máy chủ nên chưa có file PDF để xem. Hãy kết nối mạng rồi thử lại.");
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    api.fetchFile(note.id)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e: unknown) => {
        if (revoked) return;
        if (e instanceof ApiError && e.status === 404) setError("Ghi chú này không có file PDF gốc trên máy chủ.");
        else setError("Không tải được file PDF (có thể đang ngoại tuyến). Bạn vẫn đọc được văn bản đã trích ở tab ghi chú.");
      });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [note.id, api]);

  return (
    <div className="pdf-pane">
      <div className="pane-toolbar">
        <span className="pane-title">📕 {note.file_name ?? note.title}</span>
        <span className="spacer" />
        <button onClick={onOpenNote} title="Xem văn bản đã trích từ PDF này">📄 Mở ghi chú</button>
        {url && <button onClick={() => window.open(url, "_blank", "noopener")}>↗ Mở tab mới</button>}
        {url && <a className="btn" href={url} download={note.file_name ?? `${note.title}.pdf`}>⬇ Tải xuống</a>}
      </div>
      {error && <div className="empty-state">{error}</div>}
      {!error && !url && <div className="empty-state">Đang tải PDF…</div>}
      {url && <iframe className="pdf-frame" src={url} title={note.title} />}
      {url && <p className="hint">Nếu điện thoại không hiển thị PDF ở đây, hãy dùng “Mở tab mới” hoặc “Tải xuống”.</p>}
    </div>
  );
}
