# BeUs (démo)

Journal photo à deux, sous forme de PWA : un souvenir par jour et par personne (deux prises,
avant et arrière, plus la position). Le souvenir de l'autre ne s'ouvre qu'après avoir raconté le sien.
Copie de démonstration : prénoms et domaine sont fictifs, le dépôt ne contient aucune photo ni donnée.

- **Backend** : FastAPI, SQLite (WAL), photos ré-encodées à l'envoi, `backend/`
- **Frontend** : modules ES natifs, MapLibre, Web Push, `frontend/`
- **Sécurité** : PIN bcrypt avec verrouillage, JWT en cookie `HttpOnly` et `Secure`, photos servies après authentification

## Lancer

```bash
cp .env.example .env   # puis remplir
docker build -t beus-demo .
docker run -d --name beus-demo --env-file .env -v "$PWD/data:/data" -p 127.0.0.1:8600:8600 beus-demo
```

## Tests

```bash
cd backend && python3 test_jour.py && python3 test_reveal.py && python3 test_medals.py && python3 test_serie.py
```

`tests/` contient les parcours navigateur (Playwright, jsdom) et `ops/seed_dev.py` des souvenirs de test.
Fonctionnement et choix de sécurité : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
