"""API quan tri: /api/admin/*. Moi endpoint deu qua require_admin -> nguoi dung thuong nhan 403, chua dang nhap 401."""
from fastapi import APIRouter, Depends, HTTPException, Query

from ..services import admin as admin_svc
from .deps import get_conn, require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users")
def list_users(admin: dict = Depends(require_admin), conn=Depends(get_conn)):
    return admin_svc.list_users(conn)


def _set_active(conn, admin: dict, user_id: int, active: bool) -> dict:
    try:
        return admin_svc.set_active(conn, admin["id"], user_id, active)
    except LookupError:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài khoản")
    except admin_svc.AdminError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/users/{user_id}/lock")
def lock_user(user_id: int, admin: dict = Depends(require_admin), conn=Depends(get_conn)):
    return _set_active(conn, admin, user_id, False)


@router.post("/users/{user_id}/unlock")
def unlock_user(user_id: int, admin: dict = Depends(require_admin), conn=Depends(get_conn)):
    return _set_active(conn, admin, user_id, True)


@router.get("/failed-notes")
def failed_notes(limit: int = Query(200, ge=1, le=1000), admin: dict = Depends(require_admin),
                 conn=Depends(get_conn)):
    return admin_svc.failed_notes(conn, limit)
