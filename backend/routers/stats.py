"""Chiffres d'en-tête : ce qu'il reste à découvrir, et où en est chacun."""
import logging

from fastapi import APIRouter, Request

import db
from services import stats as stats_service

logger = logging.getLogger("beus.stats")
router = APIRouter(prefix="/api/beus")


@router.get("/stats")
async def get_stats(request: Request):
    with db.connect() as conn:
        return stats_service.compute(conn, request.state.user_id)
