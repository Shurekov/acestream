/* ===================================================================
   admin.js — современная, лаконичная версия БЕЗ уведомлений
   =================================================================== */

/* ----------  УТИЛИТЫ  ---------- */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const API_BASE = '/api';
const CHANNELS = ['ch1', 'ch2', 'ch3'];
const HISTORY_API = `${API_BASE}/history`;

/* ----------  STATE  ---------- */
let streams = {}; // { ch1: {ace_id, title, running}, ... }

/* ----------  RENDER  ---------- */
function render(channel, data) {
  const box = $(`#status_${channel}`);
  if (!box) return;

  const { running, ace_id, title } = data;
  box.textContent = running
    ? `Статус: Запущен (ID: ${ace_id}, Название: ${title || '—'})`
    : 'Статус: Остановлен';
  box.className = `status ${running ? 'running' : 'stopped'}`;
}

function renderHistory(list) {
  const tbody = $('#history-table tbody');
  tbody.innerHTML = '';
  list.forEach(rec => {
    const tr = document.createElement('tr');
    const t = new Date(rec.time).toLocaleString('ru-RU');
    tr.innerHTML = `
      <td>${t}</td>
      <td>${rec.channel}</td>
      <td>${rec.ace_id}</td>
      <td>${rec.title}</td>
      <td>${rec.duration ?? '—'}</td>
      <td><button class="btn-restart" data-ace="${rec.ace_id}" data-title="${rec.title}" data-ch="${rec.channel}">▶️</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function loadHistory() {
  try {
    const data = await request(HISTORY_API);
    renderHistory(data);
  } catch (e) {
    console.error('Не удалось загрузить историю:', e);
  }
}

async function clearHistory() {
  if (!confirm('Удалить всю историю?')) return;
  try {
    await request(`${HISTORY_API}/clear`, { method: 'POST' });
    loadHistory();
  } catch (e) {
    console.error('Ошибка очистки:', e);
  }
}

/* ----------  API  ---------- */
async function request(url, opts = {}) {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error((await res.json()).message || res.statusText);
  return res.json();
}

/* ----------  ACTIONS  ---------- */
async function loadAll() {
  try {
    streams = await request(`${API_BASE}/streams`);
    Object.entries(streams).forEach(([ch, d]) => render(ch, d));
    loadHistory();
  } catch (e) {
    console.error('Ошибка загрузки статусов:', e);
  }
}

async function start(ch) {
  const aceId = $(`#ace_id_${ch}`).value.trim();
  const title = ($(`#title_${ch}`) || {}).value?.trim() || `Канал ${ch.slice(-1)}`;
  if (!aceId) {
    console.warn('Введите Ace ID');
    return;
  }

  try {
    await request(`${API_BASE}/streams/${ch}/start`, {
      method: 'POST',
      body: JSON.stringify({ ace_id: aceId, title }),
    });
    $(`#ace_id_${ch}`).value = '';
    $(`#title_${ch}`) && ($(`#title_${ch}`).value = '');
    await loadAll(); // Обновляем статусы после запуска
  } catch (e) { 
    console.error(`Ошибка запуска ${ch}:`, e);
  }
}

async function stop(ch) {
  try {
    await request(`${API_BASE}/streams/${ch}/stop`, { method: 'POST' });
    await loadAll(); // Обновляем статусы после остановки
  } catch (e) { 
    console.error(`Ошибка останова ${ch}:`, e);
  }
}

/* ----------  PROBE  ---------- */
async function probeStream() {
  const aceIdInput = $('#probe-ace-id');
  const result = $('#probe-result');
  if (!aceIdInput || !result) return;

  const aceId = aceIdInput.value.trim();
  if (!aceId) {
    console.warn('Введите Ace ID');
    return;
  }

  result.innerHTML = '<p class="probe-info">Проверка потока...</p>';

  try {
    const data = await request(`${API_BASE}/probe`, {
      method: 'POST',
      body: JSON.stringify({ ace_id: aceId })
    });
    
    if (data.error) {
      result.innerHTML = `<p class="probe-error">Ошибка: ${data.error}</p>`;
      return;
    }

    let html = `
      <p class="probe-success">
        Поток проверен успешно! 
        ${data.is_fully_supported ? 
          '<span class="supported-yes">✅ Подходит для трансляции без перекодирования видео.</span>' : 
          '<span class="supported-no">⚠️ Видео требует перекодирования или аудио не поддерживается.</span>'
        }
      </p>
      <table class="probe-details">
        <thead>
          <tr>
            <th>Тип</th>
            <th>Кодек</th>
            <th>Профиль</th>
            <th>Доп. инфо</th>
            <th>Поддержка</th>
          </tr>
        </thead>
        <tbody>
    `;

    // Информация о видео
    if (data.video) {
      html += `
        <tr>
          <td>Видео</td>
          <td>${data.video.codec_name || 'N/A'}</td>
          <td>${data.video.profile || 'N/A'}</td>
          <td>${data.video.width}x${data.video.height} @ ${data.video.r_frame_rate} fps</td>
          <td class="${data.is_video_supported ? 'supported-yes' : 'supported-no'}">
            ${data.is_video_supported ? '✅ Да' : '❌ Нет'}
          </td>
        </tr>
      `;
    } else {
      html += `<tr><td>Видео</td><td colspan="4">Не найдено</td></tr>`;
    }

    // Информация об аудио
    if (data.audio) {
      const bitrateInfo = data.audio.bit_rate ? `${(parseInt(data.audio.bit_rate, 10) / 1000).toFixed(0)} kbps` : 'N/A';
      html += `
        <tr>
          <td>Аудио</td>
          <td>${data.audio.codec_name || 'N/A'}</td>
          <td>${data.audio.profile || 'N/A'}</td>
          <td>${data.audio.sample_rate || 'N/A'} Hz, ${data.audio.channels || 'N/A'} channels, ${bitrateInfo}</td>
          <td class="${data.is_audio_supported ? 'supported-yes' : 'supported-no'}">
            ${data.is_audio_supported ? '✅ Да' : '❌ Нет'}
          </td>
        </tr>
      `;
    } else {
      html += `<tr><td>Аудио</td><td colspan="4">Не найдено</td></tr>`;
    }

    html += `
            </tbody>
        </table>
        <p style="text-align: left; font-size: 0.85em; color: #aaa; margin-top: 10px;">
            Проверено на сервисе: ${data.service}
        </p>
    `;

    result.innerHTML = html;
  } catch (e) {
    result.innerHTML = `<p class="probe-error">Ошибка: ${e.message}</p>`;
  }
}

/* ----------  UI-EVENTS  ---------- */
document.addEventListener('click', (e) => {
  const ch = e.target.dataset?.channel;
  
  if (ch) {
    if (e.target.matches('.btn-start')) start(ch);
    if (e.target.matches('.btn-stop'))  stop(ch);
  }
  
  if (e.target.matches('.btn-restart')) {
  const { ace, title, ch } = e.target.dataset;
  $(`#ace_id_${ch}`).value = ace;
  $(`#title_${ch}`) && ($(`#title_${ch}`).value = title);
  start(ch);
  }
  if (e.target.id === 'btn-clear-history') clearHistory();

  // Обработчики для других кнопок
  if (e.target.id === 'btn-refresh-all') loadAll();
  if (e.target.id === 'btn-reload-page') location.reload();
  if (e.target.id === 'probe-button') probeStream();
});

// Обработка Enter в поле проверки
document.addEventListener('DOMContentLoaded', () => {
  const probeInput = $('#probe-ace-id');
  if (probeInput) {
    probeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        $('#probe-button')?.click();
      }
    });
  }
  
  // Предотвращение стандартного сабмита формы проверки
  const probeForm = $('#probe-form');
  if (probeForm) {
    probeForm.addEventListener('submit', (event) => {
      event.preventDefault();
    });
  }
  
  // Загружаем начальные данные
  loadAll();
});