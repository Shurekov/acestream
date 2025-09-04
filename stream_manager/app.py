import subprocess
import os
import signal
import logging
import json
import threading
import time
from flask import Flask, jsonify, request
import datetime

# === КОНФИГУРАЦИЯ ===
ACE_SERVICES = {
    "ch1": {"host": "ace1", "port": 6878},
    "ch2": {"host": "ace2", "port": 6878},
    "ch3": {"host": "ace3", "port": 6878},
}

ACE_PROBE_SERVICE = {"host": "ace_probe", "port": 6878}
RTMP_SERVER = "nginx-rtmp"
RTMP_PORT = 1935
LOG_DIR = "/app/logs"
STATE_FILE = "/app/data/streams_state.json"
HISTORY_FILE = "/app/data/history.jsonl"

SUPPORTED_CODECS = {
    "video": ["h264", "h.264", "avc"],
    "audio": ["aac", "aac_latm"]
}

# === ЛОГИРОВАНИЕ ===
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# === ЗАГРУЗКА/СОХРАНЕНИЕ СОСТОЯНИЯ ===
def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {
            ch: {"process": None, "ace_id": d.get("ace_id"), "title": d.get("title")}
            for ch, d in data.items()
        }
    return {ch: {"process": None, "ace_id": None, "title": None} for ch in ACE_SERVICES}

def save_state():
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    serializable = {
        ch: {"ace_id": d["ace_id"], "title": d["title"]}
        for ch, d in streams_state.items()
    }
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(serializable, f, indent=2, ensure_ascii=False)

streams_state = load_state()

def log_history(channel, ace_id, title, duration=None):
    os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
    rec = {
        "time": datetime.datetime.utcnow().isoformat() + "Z",
        "channel": channel,
        "ace_id": ace_id,
        "title": title,
        "duration": duration
    }
    with open(HISTORY_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

# === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
def get_ffmpeg_cmd(channel, ace_id):
    if channel not in ACE_SERVICES:
        raise ValueError(f"Неизвестный канал: {channel}")
    ace_info = ACE_SERVICES[channel]
    input_url = f"http://{ace_info['host']}:{ace_info['port']}/ace/getstream?id={ace_id}"
    rtmp_url = f"rtmp://{RTMP_SERVER}:{RTMP_PORT}/hls/{channel}"
    return [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-stats_period", "60",
        "-re",
        "-i", input_url,
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "128k",
        "-f", "flv",
        "-flvflags", "no_duration_filesize",
        "-g", "25",
        "-keyint_min", "25",
        "-sc_threshold", "0",
        rtmp_url
    ]

# === УПРАВЛЕНИЕ ПОТОКАМИ ===
def start_ffmpeg_process(channel, ace_id):
    try:
        cmd = get_ffmpeg_cmd(channel, ace_id)
        log_file_path = os.path.join(LOG_DIR, f"{channel}.log")

        # -------- ротация логов --------
        if os.path.exists(log_file_path) and os.path.getsize(log_file_path) > 5 * 1024 * 1024:
            os.truncate(log_file_path, 0)   # обрезаем до 0 байт
        # --------------------------------

        with open(log_file_path, 'a') as log_f:
            process = subprocess.Popen(
                cmd,
                stdout=log_f,
                stderr=subprocess.STDOUT,
                preexec_fn=os.setsid
            )
            streams_state[channel]["process"] = process
            streams_state[channel]["ace_id"] = ace_id
            logger.info(f"Запущен поток {channel} (PID: {process.pid})")
            return True, f"Поток {channel} запущен"
    except Exception as e:
        logger.error(f"Ошибка запуска потока {channel}: {e}")
        return False, f"Ошибка: {str(e)}"

def stop_ffmpeg_process(channel):
    process = streams_state[channel]["process"]
    if not process or process.poll() is not None:
        logger.info(f"Поток {channel} не запущен")
        return False, f"Поток {channel} не запущен"

    try:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        logger.info(f"Отправлен SIGTERM потоку {channel} (PID: {process.pid})")
        process.wait(timeout=5)
    except ProcessLookupError:
        logger.warning(f"Процесс {channel} уже остановлен")
    except Exception as e:
        logger.error(f"Ошибка останова: {e}")
    finally:
        streams_state[channel]["process"] = None
    return True, f"Поток {channel} остановлен"

# === ПРОВЕРКА ПОТОКОВ ===
def probe_stream(ace_id, retries=2):
    def _probe_once():
        try:
            stream_url = f"http://{ACE_PROBE_SERVICE['host']}:{ACE_PROBE_SERVICE['port']}/ace/getstream?id={ace_id}"
            cmd = [
                "ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams",
                "-timeout", "5000000", "-rw_timeout", "5000000", stream_url
            ]
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
            if result.returncode != 0:
                return {"error": "Поток недоступен"}
            data = json.loads(result.stdout)
            video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
            audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
            
            # Логируем для диагностики
            logger.info(f"Video stream: {video}")
            logger.info(f"Audio stream: {audio}")
            
            # Проверка поддержки кодеков
            video_supported = False
            audio_supported = False
            
            if video and video.get("codec_name"):
                video_codec = video.get("codec_name").lower()
                video_supported = video_codec in SUPPORTED_CODECS["video"]
                logger.info(f"Video codec: {video_codec}, supported: {video_supported}")
            
            if audio and audio.get("codec_name"):
                audio_codec = audio.get("codec_name").lower()
                audio_supported = audio_codec in SUPPORTED_CODECS["audio"]
                logger.info(f"Audio codec: {audio_codec}, supported: {audio_supported}")
            
            return {
                "video": video,
                "audio": audio,
                "is_fully_supported": video_supported and audio_supported,
                "is_video_supported": video_supported,
                "is_audio_supported": audio_supported
            }
        except Exception as e:
            logger.error(f"Probe error: {e}")
            return {"error": str(e)}

    for attempt in range(retries):
        result = _probe_once()
        if "error" not in result:
            return result
        time.sleep(1)
    return {"error": "Поток недоступен после повторных попыток"}

# === HEALTH-CHECK LOOP ===
def health_check_loop():
    while True:
        time.sleep(10)
        for ch, info in streams_state.items():
            process = info.get("process")
            ace_id = info.get("ace_id")
            title = info.get("title")
            if process and process.poll() is not None:
                logger.warning(f"Процесс {ch} упал. Перезапускаем...")
                start_ffmpeg_process(ch, ace_id)

threading.Thread(target=health_check_loop, daemon=True).start()

# === API ===
app = Flask(__name__)

@app.after_request
def after_request(response):
    save_state()
    return response

@app.route('/api/streams', methods=['GET'])
def get_streams_status():
    return jsonify({
        ch: {
            "ace_id": info["ace_id"],
            "title": info["title"],
            "running": info["process"] is not None and info["process"].poll() is None
        }
        for ch, info in streams_state.items()
    })

@app.route('/api/streams/<channel>', methods=['GET'])
def get_stream_status(channel):
    if channel not in streams_state:
        return jsonify({"error": "Неверный канал"}), 400
    info = streams_state[channel]
    return jsonify({
        "ace_id": info["ace_id"],
        "title": info["title"],
        "running": info["process"] is not None and info["process"].poll() is None
    })

@app.route('/api/streams/<channel>/start', methods=['POST'])
def start_stream(channel):
    if channel not in streams_state:
        return jsonify({"error": "Неверный канал"}), 400
    data = request.get_json()
    ace_id = data.get("ace_id")
    title = data.get("title", f"Канал {channel[-1]}")
    if not ace_id:
        return jsonify({"error": "Требуется параметр 'ace_id'"}), 400

    process = streams_state[channel]["process"]
    if process and process.poll() is None:
        stop_ffmpeg_process(channel)

    streams_state[channel]["title"] = title
    success, message = start_ffmpeg_process(channel, ace_id)
    log_history(channel, ace_id, title)   # <-- сюда
    return jsonify({"status": "ok" if success else "error", "message": message}), (200 if success else 500)

@app.route('/api/streams/<channel>/stop', methods=['POST'])
def stop_stream(channel):
    if channel not in streams_state:
        return jsonify({"error": "Неверный канал"}), 400
    success, message = stop_ffmpeg_process(channel)
    return jsonify({"status": "ok", "message": message}), 200

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy"}), 200

@app.route('/api/probe', methods=['POST'])
def api_probe_stream():
    data = request.get_json()
    ace_id = data.get("ace_id")
    if not ace_id:
        return jsonify({"error": "Требуется параметр 'ace_id'"}), 400
    return jsonify(probe_stream(ace_id))

@app.route("/api/history", methods=["GET"])
def get_history():
    if not os.path.exists(HISTORY_FILE):
        return jsonify([])
    with open(HISTORY_FILE, "r", encoding="utf-8") as f:
        lines = f.readlines()
    records = [json.loads(l) for l in lines if l.strip()]
    return jsonify(records[-50:][::-1])

@app.route("/api/history/clear", methods=["POST"])
def clear_history():
    if not os.path.exists(HISTORY_FILE):
        return jsonify({"status": "ok"})

    # собираем ace_id текущих живых потоков
    active_ace = {
        info["ace_id"]
        for info in streams_state.values()
        if info["ace_id"] and info["process"] and info["process"].poll() is None
    }

    # перезаписываем файл, оставляя только активные
    with open(HISTORY_FILE, "r+", encoding="utf-8") as f:
        lines = [l for l in f if json.loads(l).get("ace_id") in active_ace]
        f.seek(0)
        f.truncate()
        f.writelines(lines)

    return jsonify({"status": "ok"})

# === ЗАПУСК ===
if __name__ == '__main__':
    os.makedirs(LOG_DIR, exist_ok=True)
    app.run(host='0.0.0.0', port=5000, debug=False)