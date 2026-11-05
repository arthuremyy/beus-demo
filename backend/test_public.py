"""Ce qui passe sans session. Régression : POST /users/me/avatar passait pour
public, le middleware ne posait pas l'utilisateur et l'envoi plantait (500)."""
import os
os.environ.setdefault("BEUS_JWT_SECRET", "test")
from app import _est_public

cas = [
    ("/api/beus/users/sam/avatar", "GET", True),
    ("/api/beus/users/alex/avatar", "HEAD", True),
    ("/api/beus/users/me/avatar", "POST", False),
    ("/api/beus/users/me/avatar", "GET", False),
    ("/api/beus/users/sam/avatar", "POST", False),
    ("/api/beus/users/sam/profil", "GET", False),
    ("/api/beus/auth/login", "POST", True),
    ("/api/beus/health", "GET", True),
]
echecs = 0
for chemin, methode, attendu in cas:
    ok = _est_public(chemin, methode) == attendu
    echecs += not ok
    print(f"  {'✅' if ok else '❌'} {methode} {chemin} public={attendu}")
print("❌ échec" if echecs else "✅ chemins publics corrects")
raise SystemExit(1 if echecs else 0)
