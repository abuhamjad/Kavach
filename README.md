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

Weights are **not** committed to the repository. Ultralytics downloads them automatically on first run, or you can fetch them ahead of time:

```bash
cd backend
yolo predict model=yolov8m.pt source=data/videos/test.mp4   # triggers download
```

Place `yolov8m.pt` in `backend/models/`. Swap to `yolov8n.pt` for speed or `yolov8l.pt` for accuracy by editing `MODEL_FILE` in `backend/app/config.py`.

### 4️⃣ Frontend

```bash
cd frontend
npm install
npm run build
```

> [!NOTE]
> `run.py` copies this build into `backend/web/static/`. The source location is
> resolved from the repo root via `FRONTEND_BUILD_DIR` in `backend/app/config.py`
> — no manual path editing required.

### 5️⃣ Launch

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
```

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

| Method | Endpoint | Purpose |
|:--|:--|:--|
| `POST` | `/add_zone` | Register a polygon zone — `{ name, points[][] }` |
| `POST` | `/add_tripwire` | Register a tripwire — `{ name, p1[], p2[] }` |
| `POST` | `/start_detection` | Lock setup, begin detection |
| `POST` | `/stop_detection` | Halt detection, return to setup mode |
| `POST` | `/set_mode` | Toggle a detection mode — `{ mode, value }` |
| `WS` | `/ws` | Live telemetry stream (frame + alerts + zone state) |
| `GET` | `/` | React dashboard |
| `GET` | `/mobile` | Mobile operator view |

---

## ⚙️ Configuration

Tunable constants live at the top of `detect.py`:

```python
VIDEO_FILE            = 'test.mp4'    # local source
LIVE_URL              = '...'         # YouTube / stream URL
DETECT_EVERY_N_FRAMES = 2             # ↑ = faster, less smooth
PUSH_EVERY_N_FRAMES   = 3             # dashboard update cadence
LOITER_SECONDS        = 5             # dwell threshold
SURGE_WINDOW          = 90            # rolling frame window
SURGE_THRESHOLD       = 5             # person-count spike trigger
ZIGZAG_THRESHOLD      = 4             # direction changes → evasive
```

---

## 🗺️ Roadmap

- [ ] 🔧 Replace hardcoded `BUILD_PATH` with relative path resolution
- [ ] 🌍 Derive frontend `API_URL` / `WS_URL` from `window.location` so LAN access works
- [ ] 🔐 Add authentication to control endpoints — currently open with `CORS: *`
- [ ] 🧵 Guard `shared_state` / `pending_commands` with proper locking
- [ ] 📦 Move model weights and sample footage to Git LFS or a release artifact
- [ ] 🐳 Dockerfile + compose for one-command setup
- [ ] 🧪 Test suite and CI pipeline
- [ ] 📹 Multi-camera / multi-feed support
- [ ] 💾 Persist alerts to a database instead of flat files
- [ ] 📧 Push notifications for `HIGH` threat escalations

---

## ⚠️ Known Limitations

| | Issue |
|:--:|:--|
| 🔓 | Control endpoints have **no authentication** and CORS is fully open — LAN-trusted deployments only |
| 📍 | Frontend hardcodes `localhost:8000`, so the React dashboard does not work from another device (`mobile.html` does) |
| 🧵 | Shared state is mutated across threads without locks |
| 🎬 | Single video source at a time |
| 💾 | Alerts are written to flat text files, not a database |

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
