"""Gioi han toc do don gian trong bo nho (cho mot tien trinh; dat sau proxy thi can thay bang Redis)."""
import time
from collections import defaultdict, deque


class RateLimiter:
    """Cho phep toi da `limit` su kien trong `window` giay cho moi khoa."""

    def __init__(self, limit: int, window: float, clock=time.monotonic):
        self.limit, self.window, self.clock = limit, window, clock
        self._hits: dict[str, deque] = defaultdict(deque)

    def _prune(self, key: str) -> deque:
        q = self._hits[key]
        cutoff = self.clock() - self.window
        while q and q[0] <= cutoff:
            q.popleft()
        if not q:
            self._hits.pop(key, None)
            return self._hits[key]
        return q

    def blocked(self, key: str) -> bool:
        return len(self._prune(key)) >= self.limit

    def hit(self, key: str) -> None:
        self._prune(key).append(self.clock())

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)
