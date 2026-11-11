from app.core.ratelimit import RateLimiter


def test_blocks_after_limit_and_expires():
    now = [0.0]
    rl = RateLimiter(limit=3, window=60, clock=lambda: now[0])
    for _ in range(3):
        assert not rl.blocked("k")
        rl.hit("k")
    assert rl.blocked("k") and not rl.blocked("other")
    now[0] = 61
    assert not rl.blocked("k")


def test_reset_clears_key():
    rl = RateLimiter(limit=1, window=60)
    rl.hit("k")
    assert rl.blocked("k")
    rl.reset("k")
    assert not rl.blocked("k")
