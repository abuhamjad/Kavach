# Kavach detection backend — container image for Render (see /render.yaml).
# CPU-only: Render has no GPU, and the CUDA wheels would add ~2 GB for nothing.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libgl1/libglib2.0-0: runtime libraries opencv-python links against.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU torch first, so the pins in requirements.txt are already satisfied and
# pip does not pull the CUDA build from PyPI.
COPY requirements.txt .
RUN pip install torch==2.10.0 torchvision==0.25.0 --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r requirements.txt

COPY . .

# The demo video is stored in Git LFS. If the clone brought only the pointer
# file (a few hundred bytes), fetch the real clip from GitHub's LFS media host.
ARG VIDEO_URL="https://media.githubusercontent.com/media/abuhamjad/Kavach/main/backend/data/videos/Person%20Detection.mp4"
RUN f="data/videos/Person Detection.mp4"; \
    if [ "$(stat -c%s "$f" 2>/dev/null || echo 0)" -lt 1000000 ]; then \
      echo "Video is an LFS pointer; downloading" && curl -fL -o "$f" "$VIDEO_URL"; \
    fi

# Bake the weights into the image instead of downloading them on every boot.
ENV KAVACH_MODEL=yolov8n.pt
RUN python -c "from ultralytics import YOLO; YOLO('models/yolov8n.pt')"

CMD ["python", "run.py"]
