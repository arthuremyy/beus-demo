import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass
class Settings:
    db_path: str = os.getenv("DB_PATH", "/data/beus.db")
    photos_root: str = os.getenv("PHOTOS_ROOT", "/data/photos")
    jwt_secret: str = os.getenv("BEUS_JWT_SECRET", "")
    alex_pin_hash: str = os.getenv("ALEX_PIN_HASH", "")
    sam_pin_hash: str = os.getenv("SAM_PIN_HASH", "")
    tz: str = os.getenv("TZ", "Europe/Paris")
    # Web Push (services/push.py). Absentes = push désactivé, pastille seule.
    vapid_public: str = os.getenv("BEUS_VAPID_PUBLIC", "")
    vapid_private: str = os.getenv("BEUS_VAPID_PRIVATE", "")
    vapid_sub: str = os.getenv("BEUS_VAPID_SUB", "mailto:admin@example.com")


settings = Settings()
