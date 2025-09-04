/* ===================================================================
   player.js — современная, лаконичная версия БЕЗ отображения названия в статусе
   =================================================================== */

/* ----------  УТИЛИТЫ  ---------- */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const API_BASE = '/api';
const SELECTED_CHANNEL_KEY = 'selectedChannelHLS';

/* ----------  STATE  ---------- */
let streams = {}; // { ch1: {ace_id, title, running}, ... }
let hls = null;
let isVideoFullscreen = false;

/* ----------  DOM ELEMENTS  ---------- */
const video = $('#video');
const selector = $('#channel-selector');
const statusDiv = $('#status');
const liveBtn = $('#live-btn');

/* ----------  FULLSCREEN  ---------- */
const fullscreenHandlers = ['fullscreenchange', 'webkitfullscreenchange', 'msfullscreenchange'];
fullscreenHandlers.forEach(event => {
    document.addEventListener(event, () => {
        isVideoFullscreen = !!(document.fullscreenElement || 
                              document.webkitFullscreenElement || 
                              document.msFullscreenElement);
    });
});

/* ----------  RENDER  ---------- */
function updateStatus(message, isError = false) {
    if (!statusDiv) return;
    statusDiv.textContent = message;
    statusDiv.className = `status ${isError ? 'error' : 'info'}`;
}

function updateChannelOptions() {
    if (!selector) return;
    
    // Сохраняем текущее значение
    const currentValue = selector.value;
    
    // Очищаем селектор
    selector.innerHTML = '';
    
    // Добавляем опции
    Object.entries(streams).forEach(([channel, info]) => {
        const option = document.createElement('option');
        option.value = `https://shurekov.ru/hls/${channel}/index.m3u8`;
        option.textContent = info.title || `Канал ${channel.slice(-1)}`;
        if (info.running === false) {
            option.disabled = true;
            option.textContent += ' (остановлен)';
        }
        selector.appendChild(option);
    });
    
    // Восстанавливаем значение или ставим первое доступное
    if (currentValue && [...selector.options].some(opt => opt.value === currentValue)) {
        selector.value = currentValue;
    } else if (selector.options.length > 0) {
        selector.value = selector.options[0].value;
    }
}

/* ----------  API  ---------- */
async function request(url, opts = {}) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    if (!res.ok) throw new Error((await res.json()).message || res.statusText);
    return res.json();
}

async function loadAll() {
    try {
        streams = await request(`${API_BASE}/streams`);
        updateChannelOptions();
    } catch (e) {
        console.error('Ошибка загрузки статусов:', e);
    }
}

/* ----------  PLAYER  ---------- */
function toggleFullscreen() {
    if (isVideoFullscreen) {
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
    } else {
        if (video.requestFullscreen) video.requestFullscreen();
        else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
        else if (video.msRequestFullscreen) video.msRequestFullscreen();
    }
}

function goToLiveEdge() {
    if (hls?.liveSyncPosition != null) {
        video.currentTime = hls.liveSyncPosition;
    } else if (video.buffered.length > 0) {
        video.currentTime = video.buffered.end(video.buffered.length - 1);
    }
}

function switchChannel(m3u8Url) {
    // Сохраняем выбранный канал
    try {
        localStorage.setItem(SELECTED_CHANNEL_KEY, m3u8Url.trim());
    } catch (e) {
        console.warn('Не удалось сохранить канал:', e);
    }
    
    updateStatus('Загрузка потока...');
    liveBtn?.toggleAttribute('disabled', true);

    // Очистка предыдущего состояния
    if (hls) {
        hls.destroy();
        hls = null;
    }
    if (video) video.src = '';

    // Поддержка HLS через hls.js
    if (Hls.isSupported()) {
        initHlsPlayer(m3u8Url);
    } 
    // Нативная поддержка HLS
    else if (video?.canPlayType('application/vnd.apple.mpegurl')) {
        initNativePlayer(m3u8Url);
    } 
    // Нет поддержки
    else {
        updateStatus('Ваш браузер не поддерживает HLS.', true);
        liveBtn?.toggleAttribute('disabled', false);
    }
}

function initHlsPlayer(m3u8Url) {
    hls = new Hls({
        xhrSetup: xhr => xhr.setRequestHeader('Cache-Control', 'no-cache'),
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        maxFragLookUpTolerance: 0.2,
        lowLatencyMode: true,
        backBufferLength: 0
    });

    hls.loadSource(m3u8Url);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
        // Убрали отображение названия канала
        updateStatus('Поток загружен');
        
        video?.play().catch(e => updateStatus(`Ошибка: ${e.message}`, true));
        liveBtn?.toggleAttribute('disabled', false);
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
            switch(data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                    updateStatus(`Ошибка сети`, true);
                    hls.startLoad();
                    break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                    updateStatus(`Ошибка медиа`, true);
                    hls.recoverMediaError();
                    break;
                default:
                    updateStatus(`Критическая ошибка`, true);
                    hls.destroy();
                    break;
            }
        } else {
            console.warn("HLS Warning:", data.details);
        }
    });
}

function initNativePlayer(m3u8Url) {
    if (!video) return;
    
    video.src = m3u8Url;
    
    video.addEventListener('loadedmetadata', () => {
        // Убрали отображение названия канала
        updateStatus('Поток загружен');
        
        video.play().catch(e => updateStatus(`Ошибка: ${e.message}`, true));
        liveBtn?.toggleAttribute('disabled', false);
    }, { once: true });

    video.addEventListener('error', () => {
        updateStatus(`Ошибка загрузки потока`, true);
        liveBtn?.toggleAttribute('disabled', false);
    }, { once: true });
}

function getCurrentChannelFromUrl(url) {
    const match = url.match(/\/hls\/(ch\d+)\//);
    return match ? match[1] : 'ch1';
}

function getUrlParameter(name) {
    const regex = new RegExp(`[\\?&]${name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]')}=([^&#]*)`);
    const results = regex.exec(window.location.search);
    return results ? decodeURIComponent(results[1].replace(/\+/g, ' ')) : '';
}

function checkUrlChannel() {
    const channelParam = getUrlParameter('channel');
    if (channelParam) {
        const optionValue = `https://shurekov.ru/hls/${channelParam}/index.m3u8`;
        if ([...selector.options].some(option => option.value === optionValue)) {
            selector.value = optionValue;
            switchChannel(optionValue);
            return true;
        } else {
            console.warn(`Канал ${channelParam} не найден`);
        }
    }
    return false;
}

function initializePlayer() {
    const urlChannelHandled = checkUrlChannel();
    
    if (!urlChannelHandled) {
        try {
            const savedChannel = localStorage.getItem(SELECTED_CHANNEL_KEY);
            if (savedChannel && [...selector.options].some(opt => opt.value === savedChannel)) {
                selector.value = savedChannel;
            }
        } catch (e) {
            console.warn('Ошибка localStorage:', e);
        }
    }

    switchChannel(selector.value.trim());
}

/* ----------  EVENTS  ---------- */
// Video events
video?.addEventListener('click', (e) => {
    e.preventDefault();
    if (video.paused) {
        video.play().catch(err => console.log('Ошибка воспроизведения:', err));
    }
});

video?.addEventListener('dblclick', toggleFullscreen);

// Button events
liveBtn?.addEventListener('click', goToLiveEdge);

// Selector event
selector?.addEventListener('change', (event) => {
    switchChannel(event.target.value.trim());
});

// Channel selector update
selector?.addEventListener('focus', loadAll);

/* ----------  BOOT  ---------- */
document.addEventListener('DOMContentLoaded', () => {
    loadAll();
    initializePlayer();
});