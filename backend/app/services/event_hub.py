"""Dong bo truc tiep bang LISTEN/NOTIFY cua PostgreSQL.

Truoc day moi thiet bi dang mo app (mot luong SSE) hoi CSDL moi giay "co su kien moi khong?" -> 100 thiet bi
= 100 truy van/giay du khong ai sua gi. Bay gio:
  - Trigger tren bang events goi pg_notify('pkm_events', user_id) moi khi co su kien (chi khi COMMIT).
  - EventHub giu MOT ket noi LISTEN cho ca tien trinh, chay o luong nen; nhan thong bao thi danh thuc dung
    cac luong SSE cua nguoi dung do (asyncio.Event). Luong SSE chi truy van khi duoc danh thuc.
  - Luong SSE van tu hoi lai sau `fallback_seconds` (mac dinh 15 giay) de an toan neu lo mat thong bao
    (vd ket noi LISTEN dang noi lai).
"""
import asyncio
import logging
import threading
import time

from ..core.pg import EVENTS_CHANNEL, _driver

log = logging.getLogger(__name__)


class EventHub:
    def __init__(self, url: str, *, poll_timeout: float = 1.0, retry_seconds: float = 2.0):
        self.url = url
        self.poll_timeout = poll_timeout
        self.retry_seconds = retry_seconds
        self._subs: dict[int, set[tuple[asyncio.AbstractEventLoop, asyncio.Event]]] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.connected = threading.Event()  # dang LISTEN (de kiem thu / theo doi)

    # ------------------------------------------------------------ dang ky (goi tu luong SSE, trong event loop)
    def subscribe(self, user_id: int) -> asyncio.Event:
        ev = asyncio.Event()
        with self._lock:
            self._subs.setdefault(user_id, set()).add((asyncio.get_running_loop(), ev))
        return ev

    def unsubscribe(self, user_id: int, ev: asyncio.Event) -> None:
        with self._lock:
            subs = self._subs.get(user_id)
            if subs:
                subs.difference_update({s for s in subs if s[1] is ev})
                if not subs:
                    self._subs.pop(user_id, None)

    def subscriber_count(self) -> int:
        with self._lock:
            return sum(len(s) for s in self._subs.values())

    # ------------------------------------------------------------ danh thuc
    def _wake(self, user_id: int | None) -> None:
        """user_id=None: danh thuc tat ca (sau khi noi lai, co the da lo thong bao)."""
        with self._lock:
            targets = [s for uid, subs in self._subs.items() if user_id is None or uid == user_id for s in subs]
        for loop, ev in targets:
            try:
                loop.call_soon_threadsafe(ev.set)
            except RuntimeError:  # event loop da dong
                pass

    # ------------------------------------------------------------ luong LISTEN
    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="pg-listen", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=self.poll_timeout + 2)
            self._thread = None

    def _run(self) -> None:
        while not self._stop.is_set():
            conn = None
            try:
                conn = _driver().connect(self.url, autocommit=True, connect_timeout=10)
                conn.execute(f"LISTEN {EVENTS_CHANNEL}")
                self.connected.set()
                self._wake(None)  # vua (noi lai) xong: cho moi luong SSE kiem tra mot lan
                while not self._stop.is_set():
                    for n in conn.notifies(timeout=self.poll_timeout):
                        try:
                            self._wake(int(n.payload))
                        except ValueError:
                            log.warning("Thong bao su kien khong hop le: %r", n.payload)
                    if conn.closed:
                        raise ConnectionError("ket noi LISTEN bi dong")
            except Exception:  # noqa: BLE001
                if not self._stop.is_set():
                    log.exception("Ket noi LISTEN loi, thu lai sau %ss", self.retry_seconds)
                    time.sleep(self.retry_seconds)
            finally:
                self.connected.clear()
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:  # noqa: BLE001
                        pass
