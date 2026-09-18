<div align="center">

# 🛡️ KAVACH
### AI-Powered Border Surveillance System

**Real-time perimeter intrusion detection with YOLOv8, zone analytics, and a live operator console.**

[![Python](https://img.shields.io/badge/Python-3.13-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.135-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![YOLOv8](https://img.shields.io/badge/YOLOv8-Ultralytics-00FFFF?style=for-the-badge&logo=yolo&logoColor=black)](https://docs.ultralytics.com/)
[![OpenCV](https://img.shields.io/badge/OpenCV-4.11-5C3EE8?style=for-the-badge&logo=opencv&logoColor=white)](https://opencv.org/)
[![PyTorch](https://img.shields.io/badge/PyTorch-2.10-EE4C2C?style=for-the-badge&logo=pytorch&logoColor=white)](https://pytorch.org/)

![Status](https://img.shields.io/badge/status-active%20development-success?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-informational?style=flat-square)
![License](https://img.shields.io/badge/license-unlicensed-lightgrey?style=flat-square)
![SIH](https://img.shields.io/badge/Smart%20India%20Hackathon-2026-FF6B00?style=flat-square)

`computer-vision` · `object-detection` · `yolov8` · `surveillance` · `fastapi` · `react` · `real-time` · `websockets` · `edge-ai` · `border-security`

</div>

---

## 📖 Overview

**Kavach** (Sanskrit: *armour*) is a border and perimeter surveillance platform that turns any video feed — a file, an RTSP camera, or a YouTube live stream — into an actively monitored security sector.

An operator draws **restricted zones** and **tripwires** directly on the live video in the browser. From that moment the system tracks every person and vehicle that enters the frame, scores each zone's threat level in real time, and raises alerts for loitering, boundary crossings, crowd surges, evasive movement patterns, and night-time activity.

> [!NOTE]
> Built for **Smart India Hackathon 2026**. Runs fully offline on a single machine — no cloud inference, no external API keys.

---

## ✨ Features

### 🎯 Detection & Tracking

| | Capability | Detail |
|:--|:--|:--|
| 🧠 | **YOLOv8 Detection** | Persons, cars, motorcycles, buses, trucks (`conf=0.3`) |
| 🔗 | **Persistent Tracking** | Per-object track IDs maintained across frames |
| ⚡ | **Frame Skipping** | Inference every 2nd frame, dashboard push every 3rd — tuned for real-time throughput |

### 🚨 Threat Intelligence

| | Alert Type | Trigger |
|:--|:--|:--|
| 📍 | **Zone Intrusion** | Object centroid enters an operator-drawn polygon |
| ✂️ | **Tripwire Crossing** | Track path intersects a defined line segment (deduped per ID) |
| ⏱️ | **Loitering** | Dwell time inside a zone exceeds **5 seconds** |
| 📈 | **Crowd Surge** | Person count spikes over a rolling **90-frame** window |
| 🌀 | **Evasive Movement** | Zig-zag path detection over a 20-point trail |
| 🌙 | **Night Mode** | Auto-engaged when mean frame luminance drops below threshold |
| 🔺 | **Threat Escalation** | Composite `LOW → MEDIUM → HIGH` scoring, alert fired on every transition |

### 🖥️ Operator Console

- 🎨 **Draw-on-video setup** — click to place zone vertices and tripwire endpoints, no config files
- 📡 **Live WebSocket feed** — frames and telemetry streamed at ~20 Hz
- 📊 **Analytics panel** — per-zone occupancy, threat charts, rolling alert log (Recharts)
- 📱 **Mobile command view** — dedicated responsive page, installable to home screen
- 🔀 **Hot source switching** — toggle between local footage and live stream without restarting
- 📝 **Persistent audit log** — every alert timestamped to `alert_log_<timestamp>.txt`

---

## 🏗️ Architecture

```
                          ┌──────────────────────────────┐
                          │          run.py              │
                          │  build sync → uvicorn thread │
                          │       → exec(detect.py)      │
                          └───────────────┬──────────────┘
                                          │
            ┌─────────────────────────────┴─────────────────────────────┐
            │                                                           │
   ┌────────▼─────────┐                                       ┌─────────▼────────┐
   │    server.py     │        shared_state  (frames,         │    detect.py     │
   │                  │◄──────  alerts, zones, counts) ───────┤                  │
   │  FastAPI         │                                       │  OpenCV capture  │
   │  REST + /ws      │──────►  pending_commands  ───────────►│  YOLOv8 track    │
   │  static serving  │        (zones, tripwires, modes)      │  analytics       │
   └────────┬─────────┘                                       └──────────────────┘
            │
            │  WebSocket  (base64 JPEG + telemetry @ 50ms)
            │
   ┌────────▼──────────────────────────────┐
   │   React Dashboard   ·   mobile.html   │
   │   zone drawing · alerts · charts      │
   └───────────────────────────────────────┘
```

**Design note:** the detector and the API server share state through module-level Python objects (`shared_state`, `pending_commands`) inside a single process — no message broker, no database.

---

## 📂 Project Structure

```
all/
├── 📄 README.md
├── 📄 .gitignore
├── 📄 requirements.txt
│
├── 📁 backend/                     # Python backend
│   ├── 🐍 run.py                   # Launcher — build sync, server, detector
│   ├── 📁 app/                     # All Python source (importable package)
│   │   ├── 🐍 config.py            # Every path + tunable — single source of truth
│   │   ├── 🐍 server.py            # FastAPI: REST + WebSocket + static serving
│   │   └── 🐍 detect.py            # YOLOv8 pipeline, zones, tripwires, alerts
│   ├── 📁 web/                     # Browser-facing assets
│   │   ├── 🌐 mobile.html          # Standalone mobile operator view
│   │   └── 📁 static/              # React build (generated by run.py)
│   ├── 📁 models/                  # yolov8n/m/l.pt weights (not tracked — see Setup)
│   ├── 📁 data/videos/             # Sample footage (not tracked)
│   ├── 📁 logs/                    # Runtime alert logs (+ archive/ of past runs)
│   └── 📁 tests/                   # Layout + import smoke tests
│
└── 📁 frontend/                    # React frontend
    ├── 📄 package.json
    ├── 📁 public/
    └── 📁 src/
        ├── ⚛️ App.js               # Landing page + dashboard + draw overlay
        ├── 🎨 App.css
        └── ⚛️ index.js
```

---

## 🚀 Getting Started

### Prerequisites

| Requirement | Version |
|:--|:--|
| 🐍 Python | 3.11 – 3.13 |
| 📦 Node.js | 18 LTS or newer |
| 🎮 GPU *(optional)* | NVIDIA + CUDA 12.x — CPU inference works but runs slower |

### 1️⃣ Clone

```bash
git clone https://github.com/Gorosama69/Sentinal-YOLO-Object-detection.git
cd Sentinal-YOLO-Object-detection
```

### 2️⃣ Backend

```bash
python -m venv backend/venv

# Windows
backend/venv/Scripts/activate

# Linux / macOS
source backend/venv/bin/activate

pip install -r requirements.txt
```

> [!TIP]
> **For CUDA acceleration**, install PyTorch from its own index *before* the requirements file:
> ```bash
> pip install torch==2.10.0 torchvision==0.25.0 --index-url https://download.pytorch.org/whl/cu124
> pip install -r requirements.txt
> ```

### 3️⃣ Model Weights

Weights are **not** committed to the repository (`*.pt` is gitignored — they are ~52MB). Fetch them ahead of time:

```bash
cd backend
python -c "from ultralytics import YOLO; YOLO('yolov8m.pt')"   # downloads to CWD
mv yolov8m.pt models/
```

Swap to `yolov8n.pt` for speed or `yolov8l.pt` for accuracy by editing `MODEL_FILE` in `backend/app/config.py`.

### 4️⃣ Sample Footage

Sample video is **not** committed either (`*.mp4` is gitignored). `run.py` expects one file:

```
backend/data/videos/test.mp4
```

Supply your own — any MP4 of a scene with people or vehicles works. Options:

- Drop in any recording you already have and rename it `test.mp4`.
- Grab a free clip from [Pexels](https://www.pexels.com/search/videos/street/) or [Videvo](https://www.videvo.net/).
- Point at a webcam or RTSP feed instead by editing `VIDEO_FILE` in `backend/app/config.py`.
- Skip the file entirely and use the live stream — press `l` + ⏎ once running.

> [!NOTE]
> Without a readable source the loop reports `No video source available` and retries
> every few seconds rather than crashing, so you can drop the file in while it runs.

### 5️⃣ Frontend

```bash
cd frontend
npm install
npm run build
```

> [!NOTE]
> `run.py` copies this build into `backend/web/static/`. The source location is
> resolved from the repo root via `FRONTEND_BUILD_DIR` in `backend/app/config.py`
> — no manual path editing required.

### 6️⃣ Launch

```bash
cd backend
python run.py
```

```
═══════════════════════════════════════════════════════
  KAVACH BORDER SURVEILLANCE SYSTEM
═══════════════════════════════════════════════════════
  Desktop  : http://localhost:8000
  Mobile   : http://<your-lan-ip>:8000/mobile
═══════════════════════════════════════════════════════

  OPERATOR TOKEN:
  KJ8x-2fQmR7vLp0dNwZaY4hT
  (new token each run — set KAVACH_TOKEN to keep it stable)
  Required to control detection or view the feed.
═══════════════════════════════════════════════════════
```

`run.py` opens the desktop console with the token already applied. Any other
device — a phone, a second browser — is prompted for it once per tab.

---

## 🔐 Access Control

Detection control and the live video socket require a shared **operator token**.
`run.py` prints it at startup and mints a new one each run; set `KAVACH_TOKEN`
to keep it stable across restarts so open consoles survive a reload.

| Variable | Default | Purpose |
|:--|:--|:--|
| `KAVACH_TOKEN` | generated per run | Operator token. Min 16 chars from `A-Za-z0-9._~-` |
| `KAVACH_HOST` | `0.0.0.0` | Bind address. `127.0.0.1` for a desktop-only deployment |
| `KAVACH_PORT` | `8000` | Listen port |
| `KAVACH_ALLOWED_ORIGINS` | — | Extra browser origins, comma-separated (reverse proxy, hostname) |

How it works, and why:

- The token is sent in an `Authorization: Bearer` header, **not a cookie**.
  Browsers attach cookies to cross-site requests, so a cookie session would
  still be forgeable by any page an operator visits; a custom header cannot be
  set cross-origin without a CORS preflight the server refuses.
- CORS is an explicit allowlist (localhost, `127.0.0.1`, the detected LAN IP),
  never `*`. State-changing endpoints additionally reject a non-allowlisted
  `Origin` outright, independent of middleware.
- WebSockets are exempt from the same-origin policy, so `/ws` checks `Origin`
  by hand and takes the token via the `Sec-WebSocket-Protocol` header — which
  keeps it out of URLs, and therefore out of access logs and `Referer`.
- Request bodies are bounded (zone point count, coordinate range, name length)
  and `set_mode` accepts only the three real mode keys.

This is a shared-secret scheme for a single-operator LAN deployment. It is not
per-user accounts, and there is no audit trail of *who* acted — see Roadmap.

---

## 🎮 Usage

### Operator Workflow

1. 🌐 Open **`http://localhost:8000`** — the landing page loads, click through to the console
2. ✏️ Select **ZONE** mode, click points on the video to trace a restricted polygon (3+ points), hit **SAVE ZONE**
3. 📏 Select **WIRE** mode, click two points to lay a tripwire, hit **SAVE WIRE**
4. ▶️ Press **INITIATE** — detection begins and the overlay clears
5. 👁️ Monitor live threat levels, zone occupancy, and the alert feed
6. 📄 Review `alert_log_<timestamp>.txt` afterwards for the full audit trail

### Terminal Controls

While `run.py` is running, type into the console:

| Key | Action |
|:--:|:--|
| `v` + ⏎ | Switch source to the local video file |
| `l` + ⏎ | Switch source to the configured live stream |

### 🔌 API Reference

🔒 = requires the operator token (see [Access Control](#-access-control)).

| Method | Endpoint | Auth | Purpose |
|:--|:--|:--:|:--|
| `POST` | `/add_zone` | 🔒 | Register a polygon zone — `{ name, points[][] }`, 3–64 points |
| `POST` | `/add_tripwire` | 🔒 | Register a tripwire — `{ name, p1[], p2[] }` |
| `POST` | `/start_detection` | 🔒 | Lock setup, begin detection |
| `POST` | `/stop_detection` | 🔒 | Halt detection, return to setup mode |
| `POST` | `/set_mode` | 🔒 | Toggle a mode — `{ mode, value }`, mode ∈ `loitering`/`night`/`surge` |
| `POST` | `/auth/check` | 🔒 | Validate a token. No side effects |
| `WS` | `/ws` | 🔒 | Live telemetry stream (frame + alerts + zone state) |
| `GET` | `/` | | React dashboard |
| `GET` | `/mobile` | | Mobile operator view |

```bash
# Example: halt detection from the command line
curl -X POST http://localhost:8000/stop_detection \
     -H "Authorization: Bearer $KAVACH_TOKEN"
```

---

## ⚙️ Configuration

Every path and tunable lives in `backend/app/config.py` — nothing else hardcodes them:

```python
VIDEO_FILE             = '.../test.mp4'  # local source
LIVE_URL               = '...'           # YouTube / stream URL
FRAME_WIDTH            = 1280            # working geometry; published to the console
FRAME_HEIGHT           = 720             #   so zone coordinates cannot drift
DETECT_EVERY_N_FRAMES  = 2               # ↑ = faster, less smooth
PUSH_EVERY_N_FRAMES    = 3               # dashboard update cadence
LOITER_SECONDS         = 5               # dwell threshold
SURGE_WINDOW           = 90              # rolling frame window
SURGE_THRESHOLD        = 5               # person-count spike trigger
ZIGZAG_THRESHOLD       = 4               # direction changes → evasive
THREAT_DEBOUNCE_FRAMES = 5               # evaluations a level must hold before alerting
MAX_ALERTS             = 200             # alert ring size
```

> [!NOTE]
> `FRAME_WIDTH` / `FRAME_HEIGHT` are sent to the console in every telemetry
> payload. Change them here and the overlay follows — operator-drawn zones are
> mapped through this geometry, so a second copy would silently misplace them.

### Running the tests

```bash
cd backend && python -m unittest discover -s tests -t .   # 104 tests
cd frontend && npm run test:ci && npm run check:mobile-xss
```

---

## 🗺️ Roadmap

- [x] 🔧 Replace hardcoded `BUILD_PATH` with relative path resolution
- [x] 🌍 Derive frontend `API_URL` / `WS_URL` from `window.location` so LAN access works
- [x] 🔐 Add authentication to control endpoints — shared operator token, CORS allowlisted
- [x] 🧵 Guard `shared_state` / `pending_commands` with proper locking
- [x] 🧪 Test suite — 104 backend + 38 frontend
- [ ] 👤 Per-operator accounts and an audit trail of who changed what
- [ ] 🔏 TLS, so the token and the video feed are not in clear text on the wire
- [ ] 📦 Move model weights and sample footage to Git LFS or a release artifact
- [ ] 🐳 Dockerfile + compose for one-command setup
- [ ] ⚙️ CI pipeline to run both suites on every push
- [ ] 📹 Multi-camera / multi-feed support
- [ ] 💾 Persist alerts to a database instead of flat files
- [ ] 📧 Push notifications for `HIGH` threat escalations

---

## ⚠️ Known Limitations

| | Issue |
|:--:|:--|
| 🔑 | One **shared** operator token — no per-user accounts, and the alert log records what happened but not who did it |
| 🔏 | Served over plain HTTP, so the token and the video feed are readable by anything on the wire. Put it behind a TLS proxy for anything beyond a trusted LAN |
| 🎬 | Single video source at a time |
| 💾 | Alerts are written to flat text files, not a database |
| 🎯 | Frame skipping (`DETECT_EVERY_N_FRAMES`) gives the tracker a discontinuous sequence, which degrades its own motion model. Set it to `1` if track identity matters more than throughput |
| 📊 | Threat scoring is multi-signal by design: crowd size alone tops out at `MEDIUM`, since no single factor scores the 4 points `HIGH` requires |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch — `git checkout -b feature/your-feature`
3. Commit your changes — `git commit -m "Add your feature"`
4. Push the branch — `git push origin feature/your-feature`
5. Open a Pull Request

---

## 🙏 Acknowledgements

- [**Ultralytics YOLOv8**](https://github.com/ultralytics/ultralytics) — detection and tracking backbone
- [**FastAPI**](https://fastapi.tiangolo.com/) — API and WebSocket layer
- [**OpenCV**](https://opencv.org/) — video pipeline and geometry
- [**Recharts**](https://recharts.org/) — dashboard visualisations

---

<div align="center">

**Built for Smart India Hackathon 2026** 🇮🇳

*कवच — armour for the frontier*

</div>
