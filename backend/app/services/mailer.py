"""Gui email (ma OTP quen mat khau).

SmtpMailer: dung SMTP that, vd Gmail (smtp.gmail.com:587 + App Password, can bat xac minh 2 buoc).
ConsoleMailer: khi chua cau hinh SMTP (chay thu tren may) -> in noi dung email ra log cua backend.
Doi nha cung cap = viet them mot class co ham send().
"""
import logging
import smtplib
from email.message import EmailMessage
from typing import Protocol

log = logging.getLogger(__name__)


class Mailer(Protocol):
    def send(self, to: str, subject: str, body: str) -> None: ...


class SmtpMailer:
    def __init__(self, host: str, port: int, user: str, password: str, sender: str | None = None):
        self.host, self.port, self.user, self.password = host, port, user, password
        self.sender = sender or user

    def send(self, to: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.sender, to, subject
        msg.set_content(body)
        with smtplib.SMTP(self.host, self.port, timeout=20) as smtp:
            smtp.starttls()
            smtp.login(self.user, self.password)
            smtp.send_message(msg)


class ConsoleMailer:
    def send(self, to: str, subject: str, body: str) -> None:
        log.warning("[CHUA CAU HINH SMTP] Email gui toi %s | %s\n%s", to, subject, body)


def reset_email(username: str, code: str, minutes: int) -> tuple[str, str]:
    subject = f"Mã đặt lại mật khẩu: {code}"
    body = (
        f"Xin chào {username},\n\n"
        f"Mã xác nhận để đặt lại mật khẩu của bạn là: {code}\n"
        f"Mã có hiệu lực trong {minutes} phút và chỉ dùng được một lần.\n\n"
        "Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này; mật khẩu của bạn vẫn giữ nguyên.\n"
    )
    return subject, body
