"""
Notifications Web Push — ce qui fait « voir » à l'autre qu'il se passe quelque
chose sans qu'il ait à ouvrir l'app.

Sur iPhone, ça ne marche que pour une app AJOUTÉE À L'ÉCRAN D'ACCUEIL (iOS ≥
16.4) et ouverte depuis son icône : c'est le front (views/profile.js) qui
explique la marche à suivre et qui abonne l'appareil.

Deux règles :
  · un envoi raté ne fait JAMAIS échouer la requête qui l'a déclenché (on
    l'appelle en tâche de fond, et tout est avalé ici, journalisé) ;
  · une notification ne porte jamais le contenu d'un souvenir verrouillé pour
    son destinataire — c'est à l'appelant de choisir un texte neutre
    (« Sam a raconté sa journée », sans légende).

Clés VAPID absentes ⇒ push désactivé proprement : la pastille dans l'app
fonctionne toujours.
"""
import json
import logging

import db
from config import settings

logger = logging.getLogger("beus.push")

try:
    from pywebpush import WebPushException, webpush
except ImportError:          # dépendance absente : même effet que des clés absentes
    webpush = None
    WebPushException = Exception


def actif() -> bool:
    return bool(webpush and settings.vapid_public and settings.vapid_private)


def envoie(user_id: str, titre: str, corps: str, url: str = "/#/feed",
           tag: str | None = None):
    """Envoie à tous les appareils de `user_id`. Sync : à passer en tâche de
    fond (BackgroundTasks l'exécute dans un thread)."""
    if not actif():
        return
    charge = json.dumps({"title": titre, "body": corps, "url": url,
                         "tag": tag or url}, ensure_ascii=False)
    try:
        with db.connect() as conn:
            abonnements = db.rows(conn.execute(
                "SELECT endpoint, p256dh, auth FROM push_abonnements WHERE user_id=?",
                (user_id,)))
            for a in abonnements:
                try:
                    webpush(subscription_info={"endpoint": a["endpoint"],
                                               "keys": {"p256dh": a["p256dh"],
                                                        "auth": a["auth"]}},
                            data=charge,
                            vapid_private_key=settings.vapid_private,
                            vapid_claims={"sub": settings.vapid_sub},
                            ttl=12 * 3600, timeout=10)
                except WebPushException as e:
                    code = getattr(getattr(e, "response", None), "status_code", None)
                    if code in (404, 410):
                        conn.execute("DELETE FROM push_abonnements WHERE endpoint=?",
                                     (a["endpoint"],))
                        conn.commit()
                        logger.info("abonnement expiré retiré (%s)", user_id)
                    else:
                        logger.warning("push refusé pour %s : %s", user_id, code or e)
    except Exception:
        logger.exception("envoi push impossible (%s)", user_id)
