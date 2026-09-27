"""Video sources: the local file and the live stream."""

import cv2

from app import config


def get_stream_url(url):
    """Resolve a page URL to a playable stream, or None.

    Broad except by design: yt_dlp is optional, the call is network-bound, and
    every failure mode here means the same thing to the caller — fall back to
    the local file. The reason is printed rather than swallowed.
    """
    try:
        import yt_dlp
    except ImportError:
        print("yt_dlp is not installed; cannot resolve live stream URL.")
        return None

    try:
        print(f"Fetching stream URL from: {url}")
        ydl_opts = {'quiet': True, 'format': 'best[ext=mp4]/best'}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            stream = info.get('url') or info['formats'][-1]['url']
            print("Stream URL fetched successfully.")
            return stream
    except Exception as e:
        print(f"Stream fetch failed: {type(e).__name__}: {e}")
        return None


def open_capture(live=False):
    if live:
        url = get_stream_url(config.LIVE_URL)
        if url:
            cap = cv2.VideoCapture(url)
            if cap.isOpened():
                print("Live stream opened.")
                return cap, True
        print("Live stream failed. Falling back to video file.")
    print(f"Opening video file: {config.VIDEO_FILE}")
    return cv2.VideoCapture(config.VIDEO_FILE), False


def read_resized(cap):
    """Read one frame, resized to the working geometry. None if unavailable."""
    ret, frame = cap.read()
    if not ret or frame is None:
        return None
    return cv2.resize(frame, (config.FRAME_WIDTH, config.FRAME_HEIGHT))
