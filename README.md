# InMotion

PC games controlled directly over local Wi-Fi with WebRTC, with a glass pairing gate, QR/code connection, shared movement training and four games.

- Run locally: `python3 arcade/serve.py`, then open `http://localhost:8000/`.
- Upload this folder to GitHub: see [UPLOAD.md](UPLOAD.md).
- Deploy/share the beta: see [DEPLOY.md](DEPLOY.md). Deploy this root folder to one Heroku web dyno.
- Play, storage and test details: see [arcade/README.md](arcade/README.md).
- Verification and remaining device checks: see [TEST-REPORT.md](TEST-REPORT.md).

Motion and gameplay bypass Heroku. Both devices must share a reachable local network. See [DIRECT-CONNECTION.md](DIRECT-CONNECTION.md).
