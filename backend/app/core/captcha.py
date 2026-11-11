"""Xac minh hCaptcha phia may chu (token chi dung duoc mot lan, het han sau ~2 phut).

Bat bang cach dat ca HCAPTCHA_SITEKEY va HCAPTCHA_SECRET trong .env; de trong = tat captcha.
"""
import logging

import httpx

log = logging.getLogger(__name__)

VERIFY_URL = "https://api.hcaptcha.com/siteverify"


def verify_hcaptcha(secret: str, token: str, sitekey: str | None = None, timeout: float = 5.0) -> bool:
    if not token:
        return False
    data = {"secret": secret, "response": token}
    if sitekey:
        data["sitekey"] = sitekey
    try:
        r = httpx.post(VERIFY_URL, data=data, timeout=timeout)
        r.raise_for_status()
        body = r.json()
    except (httpx.HTTPError, ValueError):
        log.warning("Khong goi duoc may chu hCaptcha", exc_info=True)
        return False
    if not body.get("success"):
        log.info("hCaptcha tu choi: %s", body.get("error-codes"))
    return bool(body.get("success"))
