// 協議表決定表單欄位與預設目標；真正的網路連線由後端 Adapter 執行。
// fields 各欄依序為：設定鍵、標籤、輸入型別、預設值與可選選項。
const PROTOCOLS = {
  mqtt: {
    label: 'MQTT', symbol: 'MQ', color: '#00a9b7', description: '輕量 Publish / Subscribe 訊息傳輸。', hint: '將 JSON publish 到指定 Broker Topic。', features: ['QoS 0/1/2', 'Retain', 'Auth'],
    fields: [
      ['host', 'Broker Host', 'text', 'broker'], ['port', 'Port', 'number', 1883],
      ['topic', 'Topic', 'text', 'iot/sensor'], ['qos', 'QoS', 'select', 0, [0, 1, 2]],
      ['retain', 'Retain', 'checkbox', false], ['username', 'Username（選填）', 'text', ''],
      ['password', 'Password（選填）', 'password', '']
    ]
  },
  coap: {
    label: 'CoAP', symbol: 'Co', color: '#6f70d8', description: '面向受限裝置的 UDP 應用協議。', hint: '以 CoAP POST 傳送 JSON payload。', features: ['POST', 'JSON', 'UDP'],
    fields: [['uri', 'CoAP URI', 'text', 'coap://receiver:5683/iot']]
  },
  http: {
    label: 'HTTP / REST', symbol: 'HT', color: '#e89932', description: '通用 REST API request，支援常用 HTTP method。', hint: '送出帶有 JSON body 的 HTTP request。', features: ['POST/PUT/PATCH', 'JSON', 'Timeout'],
    fields: [['url', 'Endpoint URL', 'text', 'http://receiver:8091/iot'], ['method', 'Method', 'select', 'POST', ['POST', 'PUT', 'PATCH']], ['timeout', 'Timeout（秒）', 'number', 8]]
  },
  amqp: {
    label: 'AMQP', symbol: 'AQ', color: '#d45f86', description: '透過 RabbitMQ 等訊息代理可靠傳送。', hint: '發送至指定 Exchange 與 Routing Key。', features: ['Exchange', 'Routing Key', 'Persistent Link'],
    fields: [['url', 'AMQP URL', 'text', 'amqp://lab:lab-pass@rabbitmq:5672/'], ['exchange', 'Exchange（空白為 Default）', 'text', ''], ['routing_key', 'Routing Key', 'text', 'iot.sensor']]
  },
  websocket: {
    label: 'WebSocket', symbol: 'WS', color: '#148cce', description: '以 WebSocket JSON frame 進行即時傳輸。', hint: '每次發送建立連線，完成後關閉。', features: ['JSON Frame', 'ws / wss', 'Async'],
    fields: [['url', 'WebSocket URL', 'text', 'ws://receiver:8765']]
  },
  modbus: {
    label: 'Modbus TCP', symbol: 'MB', color: '#3d9a6e', description: '工業設備常用的 TCP register 寫入。', hint: 'v0.1 將指定 payload 數值寫入 Holding Register。', features: ['Holding Register', 'Unit ID', 'INT16'],
    fields: [['host', 'Server Host', 'text', 'receiver'], ['port', 'Port', 'number', 5020], ['address', 'Register Address', 'number', 0], ['device_id', 'Device / Unit ID', 'number', 1]]
  },
  lwm2m: {
    label: 'LwM2M', symbol: 'LW', color: '#8e5bc5', description: '透過 CoAP 傳送實驗資料到 LwM2M 路徑。', hint: '將選定 Payload 以 CoAP POST 送到 /dp。', features: ['Data POST', 'CoAP', 'UDP'],
    fields: [['server', 'LwM2M Server', 'text', 'coap://receiver:5683'], ['path', 'Data Path', 'text', '/dp']]
  }
};

// {{...}} 占位字在建立發送設定時替換；裝置卡片的 Auto Send 會沿用當時展開的內容。
const DEFAULT_TEMPLATES = [
  { id: 'sensor', name: '環境感測器', payload: { device_id: '{{device_id}}', temperature: '{{random:20:35}}', humidity: '{{random:40:80}}', timestamp: '{{timestamp}}' } },
  { id: 'industrial', name: '工業設備', payload: { device_id: '{{device_id}}', rpm: '{{int:900:1800}}', vibration: '{{random:0.1:2.5}}', temperature: '{{random:35:72}}', timestamp: '{{timestamp}}' } },
  { id: 'counter', name: '簡易計數器', payload: { device_id: '{{device_id}}', counter: '{{int:0:10000}}', timestamp: '{{timestamp}}' } }
];

// 首次開啟時顯示的虛擬裝置；使用者修改後由 localStorage 保存自己的版本。
const DEFAULT_DEVICES = [
  { id: 'temp-lab', name: 'TEMP-LAB', protocol: 'mqtt', count: 10, interval_ms: 1000, template_id: 'sensor', target: defaultsFor('mqtt') },
  { id: 'factory-motor', name: 'MOTOR-LINE-A', protocol: 'modbus', count: 1, interval_ms: 2000, template_id: 'industrial', target: defaultsFor('modbus') },
  { id: 'edge-node', name: 'EDGE-NODE', protocol: 'http', count: 5, interval_ms: 1500, template_id: 'sensor', target: defaultsFor('http') }
];

// 資料模擬器可複製的單一感測欄位設定。
const SENSOR_LIBRARY = {
  temperature: { name: 'temperature', value: 26.5, unit: '°C', data_type: 'float', mode: 'fixed', min_value: 20, max_value: 35, step: 0.5 },
  humidity: { name: 'humidity', value: 63, unit: '%', data_type: 'float', mode: 'fixed', min_value: 40, max_value: 80, step: 1 },
  co2: { name: 'co2', value: 620, unit: 'ppm', data_type: 'integer', mode: 'random', min_value: 400, max_value: 1200, step: 10 },
  pm25: { name: 'pm2_5', value: 18, unit: 'µg/m³', data_type: 'float', mode: 'random', min_value: 5, max_value: 45, step: 1 },
  light: { name: 'light', value: 450, unit: 'lux', data_type: 'integer', mode: 'range', min_value: 100, max_value: 900, step: 50 },
  pressure: { name: 'pressure', value: 1013.25, unit: 'hPa', data_type: 'float', mode: 'fixed', min_value: 980, max_value: 1040, step: 0.25 },
  battery: { name: 'battery', value: 88, unit: '%', data_type: 'integer', mode: 'range', min_value: 20, max_value: 100, step: 1 },
  voltage: { name: 'voltage', value: 220, unit: 'V', data_type: 'float', mode: 'random', min_value: 215, max_value: 225, step: 0.1 },
  current: { name: 'current', value: 1.8, unit: 'A', data_type: 'float', mode: 'random', min_value: 0.2, max_value: 5, step: 0.1 },
  power: { name: 'power', value: 396, unit: 'W', data_type: 'float', mode: 'range', min_value: 40, max_value: 1100, step: 10 }
};

// Device Template 是數個感測欄位的組合，可快速建立可編輯的裝置。
const SIM_TEMPLATES = {
  environment: { label: 'Environment Sensor', note: 'Temperature、Humidity、Light、Pressure', name: 'ENV-SENSOR-001', fields: ['temperature', 'humidity', 'light', 'pressure'] },
  air: { label: 'Air Quality Sensor', note: 'CO₂、PM2.5、Temperature、Humidity', name: 'AIR-QUALITY-001', fields: ['co2', 'pm25', 'temperature', 'humidity'] },
  power: { label: 'Smart Power Meter', note: 'Voltage、Current、Power、Battery', name: 'POWER-METER-001', fields: ['voltage', 'current', 'power', 'battery'] },
  custom: { label: 'Custom Device', note: '自行建立 Sensor Fields', name: 'CUSTOM-DEVICE-001', fields: [] }
};

// sim 是模擬器和封包檢視器的前端暫存狀態；後端另有正式發送統計。
const sim = {
  template: 'environment', protocol: 'mqtt', payloadMode: 'graphical', payloadFormat: 'json',
  fields: [], target: {}, preview: null, runId: null, packets: [], selectedPacket: null,
  transmissionFilter: null, refreshing: false
};

// URL hash 對應各頁的英文眉標與中文標題。
const PAGE_META = {
  dashboard: ['CONTROL CENTER', '系統總覽'], devices: ['DEVICE FLEET', '裝置管理'],
  simulator: ['IOT DEVICE SIMULATOR', '資料模擬器'], packets: ['PACKET CAPTURE', '封包檢視器'],
  runs: ['SIMULATION', '模擬執行'], traffic: ['OBSERVABILITY', '即時流量'],
  protocols: ['ADAPTERS', '協議設定'], payloads: ['DATA DESIGN', 'Payload 範本'],
  settings: ['PREFERENCES', '系統設定']
};

// 自訂裝置、範本與顯示偏好存在此瀏覽器，不存在 Sender 容器內。
const store = {
  get(key, fallback) { try { const value = JSON.parse(localStorage.getItem(`nexus.${key}`)); return value ?? fallback; } catch { return fallback; } },
  set(key, value) { localStorage.setItem(`nexus.${key}`, JSON.stringify(value)); }
};

// status 會定時向 /api/status 更新；其他欄位多半只供畫面互動使用。
let state = {
  devices: store.get('devices', DEFAULT_DEVICES), templates: store.get('templates', DEFAULT_TEMPLATES),
  settings: store.get('settings', { pollInterval: 1000, eventLimit: 50 }),
  status: { sent: 0, failed: 0, active: [], runs: [], events: [], protocols: {}, messages_per_second: 0, success_rate: 100 },
  online: false, editingDeviceId: null, editingTemplateId: null, selectedTemplateId: null,
  pollTimer: null, refreshing: false
};

// 動態 HTML 會包含裝置名稱等使用者輸入，插入前須用 esc 轉義。
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10)}`;

// 由協議表產生 target 的預設物件，例如 MQTT 的 host、port、topic。
function defaultsFor(protocol) {
  return Object.fromEntries(PROTOCOLS[protocol].fields.map(([key, , type, defaultValue]) => [key, type === 'number' ? Number(defaultValue) : defaultValue]));
}

// 只保存可編輯設定；Run 和發送計數由後端負責。
function persist() {
  store.set('devices', state.devices);
  store.set('templates', state.templates);
  store.set('settings', state.settings);
}

// 把舊版瀏覽器保存的 Host/Port 轉成目前 Compose 內可用的服務名稱。
function migrateStoredDevices() {
  state.devices = state.devices.map(device => {
    const target = { ...defaultsFor(device.protocol), ...(device.target || {}) };
    if (device.protocol === 'mqtt' && target.host === 'host.docker.internal') Object.assign(target, { host: 'broker', port: 1883 });
    if (device.protocol === 'http' && String(target.url || '').includes('host.docker.internal')) target.url = 'http://receiver:8091/iot';
    if (device.protocol === 'coap' && String(target.uri || '').includes('host.docker.internal')) target.uri = 'coap://receiver:5683/iot';
    if (device.protocol === 'amqp' && String(target.url || '').includes('host.docker.internal')) target.url = 'amqp://lab:lab-pass@rabbitmq:5672/';
    if (device.protocol === 'websocket' && String(target.url || '').includes('host.docker.internal')) target.url = 'ws://receiver:8765';
    if (device.protocol === 'modbus' && target.host === 'host.docker.internal') Object.assign(target, { host: 'receiver', port: 5020 });
    if (device.protocol === 'lwm2m' && String(target.server || '').includes('host.docker.internal')) Object.assign(target, { server: 'coap://receiver:5683', path: '/dp' });
    return { ...device, interval_ms: Math.max(1000, Number(device.interval_ms || 1000)), target };
  });
  persist();
}

function templateById(id) { return state.templates.find(item => item.id === id) || state.templates[0]; }
function deviceIsRunning(device) { return state.status.runs.some(run => run.name === device.name && run.protocol === device.protocol); }
function runningForDevice(device) { return state.status.runs.filter(run => run.name === device.name && run.protocol === device.protocol); }
// 在裝置卡片上把各協議不同的 target 縮成一行摘要。
function targetSummary(device) {
  const target = device.target;
  if (device.protocol === 'mqtt') return `${target.host}:${target.port}/${target.topic}`;
  if (device.protocol === 'modbus') return `${target.host}:${target.port} · reg ${target.address}`;
  return target.url || target.uri || target.server || target.host || '尚未設定';
}

// 集中處理 fetch、JSON 解析和非成功 HTTP 狀態，讓呼叫處只處理資料。
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  let data;
  try { data = await response.json(); } catch { data = { detail: await response.text() }; }
  if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
  return data;
}

// 顯示短暫操作訊息；成功通知依 API 回傳，接收端紀錄需另行查詢。
function toast(title, message = '', type = '') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = `<div><strong>${esc(title)}</strong>${message ? `<span>${esc(message)}</span>` : ''}</div>`;
  $('#toastStack').append(node);
  setTimeout(() => node.remove(), 4200);
}

// 表格或卡片沒有資料時使用統一的空白狀態樣式。
function emptyState(title, text, icon = '◇') {
  return `<div class="empty-state"><div><span>${icon}</span><strong>${esc(title)}</strong><p>${esc(text)}</p></div></div>`;
}

// 依 #dashboard、#simulator 等網址片段切頁並更新選單。
function route() {
  const page = location.hash.slice(1) || 'dashboard';
  const safePage = PAGE_META[page] ? page : 'dashboard';
  $$('.view').forEach(view => { view.hidden = view.dataset.page !== safePage; });
  $$('.nav a').forEach(link => link.classList.toggle('active', link.dataset.view === safePage));
  $('#pageEyebrow').textContent = PAGE_META[safePage][0];
  $('#pageTitle').textContent = PAGE_META[safePage][1];
  $('#sidebar').classList.remove('open');
  renderPage(safePage);
}

// 切頁時只呼叫該頁的繪製函式，避免每次把所有畫面重建。
function renderPage(page) {
  if (page === 'devices') renderDevices();
  if (page === 'simulator') renderSimulator();
  if (page === 'runs') renderRuns();
  if (page === 'traffic') renderTraffic();
  if (page === 'packets') renderPackets();
  if (page === 'protocols') renderProtocols();
  if (page === 'payloads') renderPayloads();
  if (page === 'settings') renderSettings();
  if (page === 'dashboard') renderDashboard();
}

// 把後端發送統計、近期事件和 Run 狀態映射到首頁。
function renderDashboard() {
  const status = state.status;
  $('#statSent').textContent = status.sent.toLocaleString();
  $('#statActive').textContent = status.runs.length.toLocaleString();
  $('#statRate').textContent = `${Number(status.success_rate).toFixed(status.success_rate % 1 ? 1 : 0)}%`;
  $('#statFailed').textContent = `${status.failed.toLocaleString()} 次失敗`;
  $('#statMps').textContent = Number(status.messages_per_second).toFixed(2);
  $('#activeBadge').textContent = `${status.runs.length} ACTIVE`;
  $('#recentTraffic').innerHTML = renderTrafficRows(status.events.slice(0, 5), true);
  $('#dashboardRuns').innerHTML = status.runs.length ? status.runs.slice(0, 5).map(run => `
    <div class="run-mini"><span class="pulse-icon">▶</span><div><strong>${esc(run.run_id)}</strong><small>${esc(run.name)} · ${esc(PROTOCOLS[run.protocol]?.label || run.protocol)}</small></div><button class="icon-button" data-stop-run="${esc(run.run_id)}" title="停止">■</button></div>`).join('') : emptyState('目前沒有執行中的 Run', '到裝置管理啟動模擬。', '▶');
  renderCounters();
}

// 側欄數字分別來自本機裝置、後端 Run 和已讀取的封包。
function renderCounters() {
  $('#navDeviceCount').textContent = state.devices.length;
  $('#navRunCount').textContent = state.status.runs.length;
  $('#navPacketCount').textContent = sim.packets.length;
}

// 狀態每秒輪詢，但卡片內容沒變時保留 DOM，避免閃動及關閉已展開的選單。
let renderedDevicesMarkup = null;

// 依搜尋字串畫出虛擬裝置；卡片按鈕再經事件處理器呼叫 API。
function renderDevices() {
  const query = ($('#deviceSearch')?.value || '').trim().toLowerCase();
  const devices = state.devices.filter(device => `${device.name} ${device.protocol}`.toLowerCase().includes(query));
  const markup = devices.length ? devices.map(device => {
    const protocol = PROTOCOLS[device.protocol];
    const running = deviceIsRunning(device);
    return `<article class="device-card" style="--protocol-color:${protocol.color}">
      <div class="device-card-head"><div class="device-identity"><span class="device-icon">${esc(protocol.symbol)}</span><div><h3>${esc(device.name)}</h3><p>${esc(protocol.label)} · ${device.count.toLocaleString()} DEVICE${device.count > 1 ? 'S' : ''}</p></div></div>
      <div class="card-menu"><details><summary>•••</summary><div class="card-menu-list"><button data-edit-device="${device.id}">編輯</button><button data-clone-device="${device.id}">複製</button><button class="danger-text" data-delete-device="${device.id}">刪除</button></div></details></div></div>
      <div class="device-meta"><div><span>INTERVAL</span><strong>${device.interval_ms.toLocaleString()} ms</strong></div><div><span>TARGET</span><strong title="${esc(targetSummary(device))}">${esc(targetSummary(device))}</strong></div><div><span>PAYLOAD</span><strong>${esc(templateById(device.template_id)?.name || '—')}</strong></div><div><span>STATUS</span><strong>${running ? 'RUNNING' : 'STOPPED'}</strong></div></div>
      <div class="device-actions">${running ? `<button class="button button-secondary" data-stop-device="${device.id}">■ 停止全部</button>` : `<button class="button button-primary" data-start-device="${device.id}">▶ 啟動</button>`}<button class="button button-secondary" data-send-device="${device.id}">發送一次</button><span class="device-state ${running ? 'running' : ''}">${running ? 'RUNNING' : 'READY'}</span></div>
    </article>`;
  }).join('') : emptyState('找不到裝置', query ? '請調整搜尋關鍵字。' : '建立一台裝置開始模擬。');
  if (markup !== renderedDevicesMarkup) {
    $('#deviceGrid').innerHTML = markup;
    renderedDevicesMarkup = markup;
  }
  renderCounters();
}

// 將後端執行中的 Run 顯示為表格與快速啟動入口。
function renderRuns() {
  const runs = state.status.runs;
  $('#runsTable').innerHTML = runs.length ? runs.map(run => `<tr>
    <td><code>${esc(run.run_id)}</code></td><td>${esc(run.name)}</td><td><span class="protocol-tag">${esc(PROTOCOLS[run.protocol]?.label || run.protocol)}</span></td><td>${Number(run.count || 1).toLocaleString()}</td><td>${run.interval_ms.toLocaleString()} ms</td><td>${formatTime(run.started_at)}</td><td><span class="running-text">● RUNNING</span></td><td><button class="button button-secondary button-small" data-stop-run="${esc(run.run_id)}">停止</button></td></tr>`).join('') : `<tr><td colspan="8">${emptyState('尚無執行中的 Run', '從下方選擇一台裝置啟動。', '▶')}</td></tr>`;
  $('#runLauncher').innerHTML = state.devices.length ? `<span class="eyebrow">QUICK START</span><div class="launcher-grid">${state.devices.map(device => `<button class="launcher" data-start-device="${device.id}"><span class="device-icon" style="--protocol-color:${PROTOCOLS[device.protocol].color}">${esc(PROTOCOLS[device.protocol].symbol)}</span><span><strong>${esc(device.name)}</strong><small>${esc(PROTOCOLS[device.protocol].label)} · ${device.count} devices</small></span></button>`).join('')}</div>` : '';
  renderCounters();
}

// 將後端事件的 ok/type 轉成畫面使用的成功、失敗或一般訊息類別。
function eventResult(event) {
  if (event.type?.startsWith('run.')) return ['system', event.type === 'run.started' ? 'START' : 'STOP'];
  return event.ok ? ['success', 'SUCCESS'] : ['failed', 'FAILED'];
}

// 產生流量列表中的目標或錯誤摘要，詳細內容仍保留在原始事件。
function eventDetails(event) {
  if (event.type?.startsWith('run.')) return event.type === 'run.started' ? 'Simulation run started' : 'Simulation run stopped';
  if (event.ok) return JSON.stringify(event.result || event.payload || {});
  return event.error || 'Unknown transmission error';
}

// 首頁精簡列表與流量頁共用同一套事件列格式。
function renderTrafficRows(events, compact = false) {
  if (!events.length) return emptyState('等待第一筆流量', '啟動裝置或按「發送測試」後，結果會顯示在這裡。', '≋');
  return events.map(event => {
    const [kind, label] = eventResult(event);
    return `<div class="traffic-row"><time>${formatTime(event.timestamp || event.ts, true)}</time><span class="result-pill ${kind}">${label}</span><span class="protocol-tag">${esc(PROTOCOLS[event.protocol]?.label || event.protocol || 'SYSTEM')}</span><strong title="${esc(event.run_id || event.device || '')}">${esc(event.device || event.run_id || '—')}</strong><code title="${esc(eventDetails(event))}">${esc(eventDetails(event))}</code></div>`;
  }).join('');
}

// 依協議與結果篩選後端近期事件。
function renderTraffic() {
  const protocol = $('#trafficProtocol').value;
  const result = $('#trafficResult').value;
  const limit = Number(state.settings.eventLimit);
  const events = state.status.events.filter(event => {
    const [kind] = eventResult(event);
    return (!protocol || event.protocol === protocol) && (!result || kind === result);
  }).slice(0, limit);
  $('#trafficList').innerHTML = renderTrafficRows(events);
}

// 從 PROTOCOLS 建立協議介紹卡片，並加上目前後端發送計數。
function renderProtocols() {
  $('#protocolGrid').innerHTML = Object.entries(PROTOCOLS).map(([key, protocol]) => `<article class="protocol-card" style="--protocol-color:${protocol.color}"><div class="protocol-card-top"><span class="protocol-symbol">${esc(protocol.symbol)}</span><span class="adapter-ready">● ADAPTER READY</span></div><h3>${esc(protocol.label)}</h3><p>${esc(protocol.description)}</p><div class="protocol-features">${protocol.features.map(feature => `<span>${esc(feature)}</span>`).join('')}</div><div class="device-actions" style="margin-top:18px"><button class="button button-secondary button-small" data-new-protocol="${key}">建立裝置</button><span class="device-state">${state.status.protocols[key]?.sent || 0} SENT</span></div></article>`).join('');
}

// 顯示此瀏覽器保存的 JSON 範本與可用的占位字。
function renderPayloads() {
  if (!state.selectedTemplateId || !templateById(state.selectedTemplateId)) state.selectedTemplateId = state.templates[0]?.id;
  $('#templateList').innerHTML = state.templates.length ? state.templates.map(item => `<button class="template-item ${item.id === state.selectedTemplateId ? 'active' : ''}" data-select-template="${item.id}"><strong>${esc(item.name)}</strong><small>${Object.keys(item.payload).length} fields · JSON template</small></button>`).join('') : emptyState('尚無範本', '新增一份 JSON Payload 範本。', '{ }');
  const item = templateById(state.selectedTemplateId);
  $('#payloadEditor').innerHTML = item ? `<div class="payload-editor-head"><div><span class="eyebrow">JSON TEMPLATE</span><h3>${esc(item.name)}</h3></div><div><button class="button button-secondary button-small" data-edit-payload="${item.id}">編輯</button> <button class="button button-danger-outline button-small" data-delete-payload="${item.id}">刪除</button></div></div><pre class="code-block">${esc(JSON.stringify(item.payload, null, 2))}</pre><div class="token-row"><code>{{device_id}}</code><code>{{timestamp}}</code><code>{{random:min:max}}</code><code>{{int:min:max}}</code></div>` : emptyState('選擇一個範本', '範本內容會顯示在這裡。');
}

// 將儲存的輪詢間隔和事件顯示筆數填回設定表單。
function renderSettings() {
  $('#pollInterval').value = String(state.settings.pollInterval);
  $('#eventLimit').value = String(state.settings.eventLimit);
}

// 後端事件時間以 Unix 秒數表示；轉為瀏覽器所在時區的顯示字串。
function formatTime(value, secondsOnly = false) {
  if (!value) return '—';
  const date = new Date(Number(value) * 1000);
  return date.toLocaleTimeString('zh-TW', secondsOnly ? { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour12: false, hour: '2-digit', minute: '2-digit' });
}

// 依 Sender API 是否可連線更新狀態燈，不推論各協議目標是否正常。
function setBackend(online) {
  state.online = online;
  $('#backendDot').className = `status-dot ${online ? 'online' : 'offline'}`;
  $('#backendStatus').textContent = online ? '服務正常' : '無法連線';
}

// 定期取得發送統計、近期事件與 Run；避免前一次請求未結束就重複查詢。
async function refreshStatus() {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    state.status = await api('/api/status');
    setBackend(true);
    const capture = state.status.capture || {};
    if ($('#captureStatus')) $('#captureStatus').textContent = `${capture.interface || 'eth0'} · ${capture.active ? 'ACTIVE' : 'INACTIVE'}`;
    renderDashboard();
    const page = location.hash.slice(1);
    if (page && !['dashboard', 'simulator', 'packets'].includes(page)) renderPage(page);
    if (page === 'packets') refreshPackets();
  } catch {
    setBackend(false);
  } finally { state.refreshing = false; }
}

// 更改輪詢頻率時先清掉舊定時器，避免同時建立多個更新工作。
function resetPoller() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(refreshStatus, Number(state.settings.pollInterval));
}

// 遞迴替換範本中的裝置 ID、時間、浮點隨機值與整數隨機值。
function materializeTemplate(value, deviceId) {
  // 範本可能有巢狀物件或陣列，因此先遞迴處理容器，再解析葉節點的占位字。
  if (Array.isArray(value)) return value.map(item => materializeTemplate(item, deviceId));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materializeTemplate(item, deviceId)]));
  if (typeof value !== 'string') return value;
  if (value === '{{device_id}}') return deviceId;
  if (value === '{{timestamp}}') return new Date().toISOString();
  let match = value.match(/^\{\{random:([-\d.]+):([-\d.]+)\}\}$/);
  if (match) return Number((Number(match[1]) + Math.random() * (Number(match[2]) - Number(match[1]))).toFixed(4));
  match = value.match(/^\{\{int:([-\d.]+):([-\d.]+)\}\}$/);
  if (match) return Math.floor(Number(match[1]) + Math.random() * (Number(match[2]) - Number(match[1]) + 1));
  return value;
}

// 將裝置管理卡片轉為後端 DeviceConfig，並把範本展開成 raw_json。
function buildDevicePayload(device) {
  const template = templateById(device.template_id);
  if (!template) throw new Error('找不到指定的 Payload 範本');
  // 此處的時間與隨機值只計算一次；背景 Run 之後會重送這份 raw_json。
  return {
    name: device.name, protocol: device.protocol, interval_ms: Math.max(1000, Number(device.interval_ms)), target: device.target,
    payload_mode: 'raw_json', payload_format: 'json', sensor_fields: [],
    raw_json: materializeTemplate(template.payload, `${device.name}-001`)
  };
}

// 為「裝置管理」卡片建立後端 Run；後端會依 interval_ms 重複發送。
async function startDevice(id) {
  const device = state.devices.find(item => item.id === id);
  if (!device) return;
  const runId = `${device.id}-${Date.now().toString(36)}`;
  try {
    await api(`/api/runs/${encodeURIComponent(runId)}`, { method: 'POST', body: JSON.stringify(buildDevicePayload(device)) });
    toast('Run 已啟動', `${device.name} · ${PROTOCOLS[device.protocol].label}`, 'success');
    await refreshStatus();
  } catch (error) { toast('無法啟動 Run', error.message, 'error'); }
}

// 告訴後端取消指定 Run，並重新讀取狀態更新畫面。
async function stopRun(runId) {
  try {
    const result = await api(`/api/runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
    if (!result.ok) throw new Error('找不到這個 Run，可能已經停止');
    toast('Run 已停止', runId, 'success');
    await refreshStatus();
  } catch (error) { toast('停止失敗', error.message, 'error'); }
}

// 用裝置卡片的範本產生一次 Payload，再呼叫後端單次發送 API。
async function sendDevice(id) {
  const device = state.devices.find(item => item.id === id);
  if (!device) return;
  try {
    const payload = buildDevicePayload(device);
    const result = await api('/api/send-once', { method: 'POST', body: JSON.stringify({ config: payload }) });
    if (result.ok) toast('發送成功', `${device.name} · ${PROTOCOLS[device.protocol].label}`, 'success');
    else toast('目標端回報失敗', result.error, 'error');
    await refreshStatus();
  } catch (error) { toast('發送失敗', error.message, 'error'); }
}

// 建立或編輯裝置時填入表單；forcedProtocol 供協議卡片快捷入口使用。
function openDeviceDialog(id = null, forcedProtocol = null) {
  state.editingDeviceId = id;
  const device = id ? state.devices.find(item => item.id === id) : null;
  const form = $('#deviceForm');
  form.reset();
  $('#dialogTitle').textContent = device ? '編輯虛擬裝置' : '新增虛擬裝置';
  form.elements.name.value = device?.name || '';
  form.elements.protocol.value = device?.protocol || forcedProtocol || 'mqtt';
  form.elements.count.value = device?.count || 1;
  form.elements.interval_ms.value = device?.interval_ms || 1000;
  fillTemplateSelect(device?.template_id || state.templates[0]?.id);
  renderTargetFields(form.elements.protocol.value, device?.target);
  $('#deviceDialog').showModal();
}

// 依目前保存的 Payload 範本重建選單。
function fillTemplateSelect(selected) {
  $('#deviceTemplate').innerHTML = state.templates.map(item => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
}

// 不同協議需要不同目標設定；表單欄位由 PROTOCOLS.fields 動態建立。
function renderTargetFields(protocolKey, values = null) {
  const protocol = PROTOCOLS[protocolKey];
  $('#protocolHint').textContent = protocol.hint;
  $('#targetFields').innerHTML = protocol.fields.map(([key, label, type, defaultValue, options]) => {
    const value = values?.[key] ?? defaultValue;
    if (type === 'checkbox') return `<label class="field checkbox-field"><span>${esc(label)}</span><span class="checkbox-wrap"><input name="target.${key}" type="checkbox" ${value ? 'checked' : ''}> 啟用</span></label>`;
    if (type === 'select') return `<label class="field"><span>${esc(label)}</span><select name="target.${key}">${options.map(option => `<option value="${esc(option)}" ${String(option) === String(value) ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select></label>`;
    return `<label class="field"><span>${esc(label)}</span><input name="target.${key}" type="${type}" value="${esc(value)}" ${type === 'number' ? 'step="any"' : ''}></label>`;
  }).join('');
  updateTargetPreview();
}

// 從目前顯示的目標欄位讀回 target 物件，供裝置保存或預覽。
function readTargetForm() {
  const protocol = PROTOCOLS[$('#deviceProtocol').value];
  const target = {};
  protocol.fields.forEach(([key, , type]) => {
    const field = $(`[name="target.${key}"]`, $('#deviceForm'));
    target[key] = type === 'checkbox' ? field.checked : type === 'number' ? Number(field.value) : field.value;
  });
  return target;
}

// 讓使用者在儲存前看到實際會交給後端的協議目標設定。
function updateTargetPreview() { $('#targetPreview').textContent = JSON.stringify(readTargetForm(), null, 2); }

// 驗證裝置表單並保存於 localStorage；真正發送仍在按下操作時才開始。
function saveDevice(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const existing = state.devices.find(item => item.id === state.editingDeviceId);
  const device = {
    id: existing?.id || uid('device'), name: form.elements.name.value.trim(), protocol: form.elements.protocol.value,
    count: Number(form.elements.count.value), interval_ms: Math.max(1000, Number(form.elements.interval_ms.value)),
    template_id: form.elements.template_id.value, target: readTargetForm()
  };
  if (!device.name) return;
  if (existing) state.devices = state.devices.map(item => item.id === existing.id ? device : item);
  else state.devices.push(device);
  persist();
  $('#deviceDialog').close();
  renderDevices();
  toast(existing ? '裝置已更新' : '裝置已建立', `${device.name} · ${PROTOCOLS[device.protocol].label}`, 'success');
}

// 複製本機設定並換一個 ID，避免兩張裝置卡片指向同一個設定物件。
function cloneDevice(id) {
  const source = state.devices.find(item => item.id === id);
  if (!source) return;
  state.devices.push({ ...structuredClone(source), id: uid('device'), name: `${source.name}-COPY` });
  persist(); renderDevices(); toast('已複製裝置', source.name, 'success');
}

// 移除本機裝置定義；已啟動的後端 Run 仍需另外停止。
function deleteDevice(id) {
  const device = state.devices.find(item => item.id === id);
  if (!device || !confirm(`確定刪除「${device.name}」？執行中的 Run 不會自動停止。`)) return;
  state.devices = state.devices.filter(item => item.id !== id);
  persist(); renderDevices(); toast('已刪除裝置', device.name);
}

// 打開 JSON 範本編輯器，載入既有內容或預設占位字。
function openPayloadDialog(id = null) {
  state.editingTemplateId = id;
  const item = id ? templateById(id) : null;
  const form = $('#payloadForm');
  form.reset(); $('#payloadError').textContent = '';
  $('#payloadDialogTitle').textContent = item ? '編輯 Payload 範本' : '新增 Payload 範本';
  form.elements.name.value = item?.name || '';
  form.elements.payload.value = JSON.stringify(item?.payload || { device_id: '{{device_id}}', value: '{{random:0:100}}', timestamp: '{{timestamp}}' }, null, 2);
  $('#payloadDialog').showModal();
}

// 先確認輸入是 JSON 物件，再保存範本供裝置卡片引用。
function savePayload(event) {
  event.preventDefault();
  const form = event.currentTarget;
  let payload;
  try {
    payload = JSON.parse(form.elements.payload.value);
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') throw new Error('最外層必須是 JSON object');
  } catch (error) { $('#payloadError').textContent = `JSON 格式錯誤：${error.message}`; return; }
  const existing = state.templates.find(item => item.id === state.editingTemplateId);
  const item = { id: existing?.id || uid('payload'), name: form.elements.name.value.trim(), payload };
  if (existing) state.templates = state.templates.map(template => template.id === existing.id ? item : template);
  else state.templates.push(item);
  state.selectedTemplateId = item.id; persist(); $('#payloadDialog').close(); renderPayloads(); toast('Payload 範本已儲存', item.name, 'success');
}

// 被裝置引用中的範本不可刪除，避免後續發送找不到 Payload。
function deletePayload(id) {
  const item = templateById(id);
  const referenced = state.devices.filter(device => device.template_id === id);
  if (referenced.length) { toast('無法刪除範本', `仍有 ${referenced.length} 個裝置使用此範本`, 'error'); return; }
  if (!item || !confirm(`確定刪除「${item.name}」？`)) return;
  state.templates = state.templates.filter(template => template.id !== id); state.selectedTemplateId = state.templates[0]?.id; persist(); renderPayloads();
}

// 每次套用範本都深複製感測欄位，修改一台裝置不會污染共用預設值。
function cloneSensor(key) { return structuredClone(SENSOR_LIBRARY[key]); }

// 將 Device Template 的欄位與名稱帶入模擬器，並重新產生預覽。
function applySimTemplate(key) {
  const template = SIM_TEMPLATES[key] || SIM_TEMPLATES.environment;
  sim.template = key;
  sim.fields = template.fields.map(cloneSensor);
  $('#simDeviceName').value = template.name;
  sim.preview = null;
  renderSimulator();
  refreshSimPreview();
}

// 初次進入時初始化預設欄位；之後只依 sim 狀態重畫控制項。
function renderSimulator() {
  if (!sim.fields.length && !sim.initialized) {
    sim.initialized = true;
    const template = SIM_TEMPLATES[sim.template];
    sim.fields = template.fields.map(cloneSensor);
  }
  $('#simTemplateGrid').innerHTML = Object.entries(SIM_TEMPLATES).map(([key, template]) => `<button class="sim-template ${key === sim.template ? 'active' : ''}" data-sim-template="${key}"><strong>${esc(template.label)}</strong><small>${esc(template.note)}</small></button>`).join('');
  $('#simProtocol').value = sim.protocol;
  renderSimTargetFields();
  renderSimSensorRows();
  renderSimMode();
}

// 模擬器目標欄位與「裝置管理」共用協議表，但維持獨立的 sim.target。
function renderSimTargetFields() {
  const protocol = PROTOCOLS[sim.protocol];
  sim.target = { ...defaultsFor(sim.protocol), ...sim.target };
  $('#simProtocolHint').textContent = protocol.hint;
  $('#simTargetFields').innerHTML = protocol.fields.map(([key, label, type, defaultValue, options]) => {
    const value = sim.target[key] ?? defaultValue;
    if (type === 'checkbox') return `<label class="field checkbox-field"><span>${esc(label)}</span><span class="checkbox-wrap"><input data-sim-target="${key}" type="checkbox" ${value ? 'checked' : ''}> 啟用</span></label>`;
    if (type === 'select') return `<label class="field"><span>${esc(label)}</span><select data-sim-target="${key}">${options.map(option => `<option value="${esc(option)}" ${String(option) === String(value) ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select></label>`;
    return `<label class="field"><span>${esc(label)}</span><input data-sim-target="${key}" type="${type}" value="${esc(value)}" ${type === 'number' ? 'step="any"' : ''}></label>`;
  }).join('');
}

// 每一列對應一個 SensorField，含型別、固定值、範圍與步長輸入。
function renderSimSensorRows() {
  $('#simSensorRows').innerHTML = sim.fields.length ? sim.fields.map((field, index) => `<tr>
    <td><input data-sim-field="name" data-index="${index}" value="${esc(field.name)}"></td>
    <td><input data-sim-field="value" data-index="${index}" type="${field.data_type === 'string' ? 'text' : 'number'}" step="any" value="${esc(field.value)}"></td>
    <td><input data-sim-field="unit" data-index="${index}" value="${esc(field.unit)}"></td>
    <td><select data-sim-field="data_type" data-index="${index}">${['float','integer','string','boolean'].map(value => `<option value="${value}" ${value === field.data_type ? 'selected' : ''}>${value}</option>`).join('')}</select></td>
    <td><select data-sim-field="mode" data-index="${index}">${['fixed','random','range'].map(value => `<option value="${value}" ${value === field.mode ? 'selected' : ''}>${value}</option>`).join('')}</select></td>
    <td><div class="range-fields"><input title="Min" data-sim-field="min_value" data-index="${index}" type="number" step="any" value="${esc(field.min_value ?? '')}"><input title="Max" data-sim-field="max_value" data-index="${index}" type="number" step="any" value="${esc(field.max_value ?? '')}"><input title="Step" data-sim-field="step" data-index="${index}" type="number" step="any" value="${esc(field.step ?? '')}"></div></td>
    <td><button class="remove-field" data-remove-sim-field="${index}" title="移除">×</button></td>
  </tr>`).join('') : `<tr><td colspan="7">${emptyState('尚無 Sensor Field', '按 Custom Field 建立第一個欄位。', '{ }')}</td></tr>`;
}

// raw_json 使用使用者直接輸入的 JSON；graphical 才會套用輸出格式選擇。
function renderSimMode() {
  $$('#simPayloadMode button').forEach(button => button.classList.toggle('active', button.dataset.mode === sim.payloadMode));
  $$('#simPayloadFormat button').forEach(button => button.classList.toggle('active', button.dataset.format === sim.payloadFormat));
  $('#simGraphicalEditor').hidden = sim.payloadMode !== 'graphical';
  $('#simRawEditor').hidden = sim.payloadMode !== 'raw_json';
  $('#simPayloadFormat').style.opacity = sim.payloadMode === 'raw_json' ? '.45' : '1';
}

// 把目前協議專用的表單欄位轉回後端 Adapter 使用的 target 物件。
function collectSimTarget() {
  const target = {};
  $$('[data-sim-target]').forEach(input => { target[input.dataset.simTarget] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value; });
  sim.target = target;
  return target;
}

// 組合完整 DeviceConfig；原始 JSON 模式先在瀏覽器檢查 JSON 語法。
function collectSimConfig() {
  let raw = {};
  if (sim.payloadMode === 'raw_json') {
    try { raw = JSON.parse($('#simRawJson').value); $('#simRawError').textContent = ''; }
    catch (error) { $('#simRawError').textContent = `JSON 格式錯誤：${error.message}`; throw error; }
  }
  return {
    name: $('#simDeviceName').value.trim() || 'DEVICE-001', protocol: sim.protocol,
    interval_ms: Number($('#simInterval').value), target: collectSimTarget(), payload_mode: sim.payloadMode,
    payload_format: sim.payloadFormat, sensor_fields: sim.fields, raw_json: raw
  };
}

// 呼叫 /api/preview 讓後端產生真正的 Payload，畫面只負責顯示結果。
async function refreshSimPreview() {
  try {
    const result = await api('/api/preview', { method: 'POST', body: JSON.stringify({ config: collectSimConfig() }) });
    // preview_id 指向後端暫存的 bytes；畫面只保存 ID 和供人閱讀的預覽文字。
    sim.preview = result;
    $('#simPayloadPreview').textContent = result.preview;
    $('#simPreviewFormat').textContent = result.payload_format.toUpperCase();
    $('#simPreviewType').textContent = result.content_type;
    $('#simPreviewBytes').textContent = `${result.byte_length} BYTES`;
  } catch (error) {
    $('#simPayloadPreview').textContent = `無法產生預覽：${error.message}`;
  }
}

// 把預覽 ID 與設定一起交給 /api/send-once，讓發送盡量沿用剛看到的 bytes。
async function sendSimOnce() {
  try {
    if (!sim.preview) await refreshSimPreview();
    const result = await api('/api/send-once', { method: 'POST', body: JSON.stringify({ config: collectSimConfig(), preview_id: sim.preview?.preview_id }) });
    // 後端的 preview_id 只能消耗一次；清空後再預覽下一筆隨機資料。
    sim.preview = null;
    // 封包頁預設只看這次 transmission_id 關聯到的封包。
    sim.transmissionFilter = result.transmission_id;
    $('#simLastSend').textContent = result.ok ? `✓ ${result.protocol.toUpperCase()} 已送出 ${result.payload_bytes} bytes，擷取 ${result.packet_count} packets` : `發送失敗：${result.error}`;
    toast(result.ok ? '發送成功' : '發送失敗', result.ok ? `${result.protocol.toUpperCase()} · ${result.packet_count} packets` : result.error, result.ok ? 'success' : 'error');
    await Promise.all([refreshStatus(), refreshPackets()]);
    await refreshSimPreview();
  } catch (error) { toast('發送失敗', error.message, 'error'); }
}

// 開啟時建立後端背景 Run；再次按下則用相同 runId 停止。
async function toggleSimAutoSend() {
  try {
    if (sim.runId) {
      await api(`/api/runs/${encodeURIComponent(sim.runId)}`, { method: 'DELETE' });
      sim.runId = null;
      $('#simAutoSend').textContent = '▶ Start Auto Send';
      toast('Auto Send 已停止', '', 'success');
    } else {
      // Run 的計時與重複發送都發生在後端；瀏覽器只保存用來停止的 ID。
      sim.runId = `sim-${Date.now().toString(36)}`;
      await api(`/api/runs/${encodeURIComponent(sim.runId)}`, { method: 'POST', body: JSON.stringify(collectSimConfig()) });
      $('#simAutoSend').textContent = '■ Stop Auto Send';
      toast('Auto Send 已啟動', `${$('#simInterval option:checked').textContent}`, 'success');
    }
    await refreshStatus();
  } catch (error) { sim.runId = null; $('#simAutoSend').textContent = '▶ Start Auto Send'; toast('Auto Send 操作失敗', error.message, 'error'); }
}

// 輪詢 /api/packets，並防止前一次封包請求尚未完成就再次發送。
async function refreshPackets() {
  if (sim.refreshing) return;
  sim.refreshing = true;
  try {
    const result = await api('/api/packets?limit=500');
    sim.packets = result.packets || [];
    $('#packetInterface').textContent = result.capture?.interface || 'eth0';
    renderPacketData();
  } catch (error) { if ($('#packetRows')) $('#packetRows').innerHTML = `<tr><td colspan="7">${emptyState('無法讀取封包', error.message, '▤')}</td></tr>`; }
  finally { sim.refreshing = false; }
}

// 進入封包頁時先顯示既有資料，再向後端更新。
function renderPackets() {
  renderPacketData();
  refreshPackets();
}

// 依傳輸 ID、協議與方向篩選；篩選只影響畫面，不刪除後端封包。
function renderPacketData() {
  if (!$('#packetRows')) return;
  // application_protocol 是後端依發送時間貼上的標籤，不是逐封包解碼的結果。
  const protocol = $('#packetProtocol').value;
  const direction = $('#packetDirection').value;
  const packets = sim.packets.filter(packet => (!sim.transmissionFilter || packet.transmission_id === sim.transmissionFilter) && (!protocol || packet.application_protocol === protocol) && (!direction || packet.direction === direction));
  $('#packetCount').textContent = sim.packets.length;
  $('#navPacketCount').textContent = sim.packets.length;
  $('#packetTransmission').textContent = sim.transmissionFilter || '—';
  $('#packetRows').innerHTML = packets.length ? packets.map(packet => `<tr class="packet-row ${sim.selectedPacket?.id === packet.id ? 'selected' : ''}" data-packet-id="${packet.id}"><td>${packet.id}</td><td>${formatTime(packet.timestamp, true)}</td><td><span class="direction-tag ${packet.direction}">${packet.direction}</span></td><td><span class="protocol-tag">${esc((packet.application_protocol || packet.transport).toUpperCase())}</span></td><td><code>${esc(packet.source)}</code></td><td><code>${esc(packet.destination)}</code></td><td>${packet.length} B</td></tr>`).join('') : `<tr><td colspan="7">${emptyState('尚無符合條件的封包', '按 Send Once 後會顯示實際網路封包。', '▤')}</td></tr>`;
  renderPacketDetail();
}

// 顯示選定封包的路徑、長度、文字預覽與原始十六進位片段。
function renderPacketDetail() {
  const packet = sim.selectedPacket;
  if (!packet) return;
  $('#packetDetail').innerHTML = `<h4>PACKET #${packet.id} · ${esc((packet.application_protocol || packet.transport).toUpperCase())}</h4><dl><dt>時間</dt><dd>${new Date(packet.timestamp * 1000).toISOString()}</dd><dt>方向</dt><dd>${packet.direction}</dd><dt>來源</dt><dd>${esc(packet.source)}</dd><dt>目的</dt><dd>${esc(packet.destination)}</dd><dt>封包長度</dt><dd>${packet.length} bytes</dd><dt>Payload</dt><dd>${packet.payload_length} bytes</dd><dt>Transmission</dt><dd>${esc(packet.transmission_id || '—')}</dd></dl><span class="eyebrow">APPLICATION PAYLOAD</span><pre>${esc(packet.ascii_preview || '（此封包沒有可顯示的文字 Payload）')}</pre><span class="eyebrow">RAW PACKET HEX</span><pre>${esc(packet.packet_hex || '')}</pre>`;
}

let simPreviewTimer = null;
// 使用者連續輸入時延遲 250 ms 才重建預覽，減少不必要的 API 呼叫。
function scheduleSimPreview() {
  sim.preview = null;
  clearTimeout(simPreviewTimer);
  simPreviewTimer = setTimeout(refreshSimPreview, 250);
}

// 集中綁定表單、按鈕與封包列事件；動態產生的按鈕使用事件委派。
function bindEvents() {
  window.addEventListener('hashchange', route);
  $('#menuButton').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#deviceSearch').addEventListener('input', renderDevices);
  $('#trafficProtocol').addEventListener('change', renderTraffic);
  $('#trafficResult').addEventListener('change', renderTraffic);
  $('#deviceProtocol').addEventListener('change', event => renderTargetFields(event.target.value));
  $('#targetFields').addEventListener('input', updateTargetPreview);
  $('#deviceForm').addEventListener('submit', saveDevice);
  $('#payloadForm').addEventListener('submit', savePayload);
  $('#simProtocol').addEventListener('change', event => { sim.protocol = event.target.value; sim.target = defaultsFor(sim.protocol); renderSimTargetFields(); scheduleSimPreview(); });
  $('#simTargetFields').addEventListener('input', scheduleSimPreview);
  $('#simDeviceName').addEventListener('input', scheduleSimPreview);
  $('#simInterval').addEventListener('change', scheduleSimPreview);
  $('#simRawJson').addEventListener('input', scheduleSimPreview);
  $('#simRefreshPreview').addEventListener('click', refreshSimPreview);
  $('#simSendOnce').addEventListener('click', sendSimOnce);
  $('#simAutoSend').addEventListener('click', toggleSimAutoSend);
  $('#simAddCustom').addEventListener('click', () => { sim.fields.push({ name: `custom_${sim.fields.length + 1}`, value: 0, unit: '', data_type: 'float', mode: 'fixed', min_value: 0, max_value: 100, step: 1 }); renderSimSensorRows(); scheduleSimPreview(); });
  $('#simPayloadMode').addEventListener('click', event => { if (!event.target.dataset.mode) return; sim.payloadMode = event.target.dataset.mode; renderSimMode(); scheduleSimPreview(); });
  $('#simPayloadFormat').addEventListener('click', event => { if (!event.target.dataset.format || sim.payloadMode === 'raw_json') return; sim.payloadFormat = event.target.dataset.format; renderSimMode(); scheduleSimPreview(); });
  $('#simSensorRows').addEventListener('input', event => {
    const input = event.target.closest('[data-sim-field]'); if (!input) return;
    const field = sim.fields[Number(input.dataset.index)]; const key = input.dataset.simField;
    field[key] = ['value','min_value','max_value','step'].includes(key) && input.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value;
    scheduleSimPreview();
  });
  $('#simSensorRows').addEventListener('change', event => { const input = event.target.closest('[data-sim-field]'); if (!input) return; const field = sim.fields[Number(input.dataset.index)]; field[input.dataset.simField] = input.value; if (input.dataset.simField === 'data_type') renderSimSensorRows(); scheduleSimPreview(); });
  $('#packetProtocol').addEventListener('change', renderPacketData);
  $('#packetDirection').addEventListener('change', renderPacketData);
  $('#showAllPackets').addEventListener('click', () => { sim.transmissionFilter = null; renderPacketData(); });
  $('#clearPackets').addEventListener('click', async () => { await api('/api/packets', { method: 'DELETE' }); sim.packets = []; sim.selectedPacket = null; sim.transmissionFilter = null; renderPacketData(); toast('封包已清除'); });
  $('#packetRows').addEventListener('click', event => { const row = event.target.closest('[data-packet-id]'); if (!row) return; sim.selectedPacket = sim.packets.find(packet => packet.id === Number(row.dataset.packetId)); renderPacketData(); });
  $('#pollInterval').addEventListener('change', event => { state.settings.pollInterval = Number(event.target.value); persist(); resetPoller(); toast('更新頻率已儲存'); });
  $('#eventLimit').addEventListener('change', event => { state.settings.eventLimit = Number(event.target.value); persist(); renderTraffic(); toast('顯示筆數已儲存'); });

  // 卡片和表格會重畫，故從 document 向上找 data-*，避免每次重畫都重新綁定。
  document.addEventListener('click', async event => {
    const button = event.target.closest('button, [data-go]');
    if (!button) return;
    if (button.dataset.go) location.hash = button.dataset.go;
    if (button.dataset.simTemplate) applySimTemplate(button.dataset.simTemplate);
    if (button.dataset.removeSimField !== undefined) { sim.fields.splice(Number(button.dataset.removeSimField), 1); renderSimSensorRows(); scheduleSimPreview(); }
    if (button.dataset.action === 'add-device') openDeviceDialog();
    if (button.dataset.action === 'close-dialog') $('#deviceDialog').close();
    if (button.dataset.action === 'add-payload') openPayloadDialog();
    if (button.dataset.action === 'close-payload-dialog') $('#payloadDialog').close();
    if (button.dataset.action === 'send-demo') {
      if (state.devices[0]) sendDevice(state.devices[0].id); else openDeviceDialog();
    }
    if (button.dataset.action === 'reset-local' && confirm('確定重設所有本機裝置、範本與設定？')) {
      ['devices', 'templates', 'settings'].forEach(key => localStorage.removeItem(`nexus.${key}`));
      state.devices = structuredClone(DEFAULT_DEVICES); state.templates = structuredClone(DEFAULT_TEMPLATES); state.settings = { pollInterval: 1000, eventLimit: 50 }; persist(); renderPage(location.hash.slice(1) || 'dashboard'); toast('本機資料已重設', '', 'success');
    }
    if (button.dataset.startDevice) startDevice(button.dataset.startDevice);
    if (button.dataset.sendDevice) sendDevice(button.dataset.sendDevice);
    if (button.dataset.stopRun) stopRun(button.dataset.stopRun);
    if (button.dataset.stopDevice) runningForDevice(state.devices.find(item => item.id === button.dataset.stopDevice)).forEach(run => stopRun(run.run_id));
    if (button.dataset.editDevice) openDeviceDialog(button.dataset.editDevice);
    if (button.dataset.cloneDevice) cloneDevice(button.dataset.cloneDevice);
    if (button.dataset.deleteDevice) deleteDevice(button.dataset.deleteDevice);
    if (button.dataset.newProtocol) openDeviceDialog(null, button.dataset.newProtocol);
    if (button.dataset.selectTemplate) { state.selectedTemplateId = button.dataset.selectTemplate; renderPayloads(); }
    if (button.dataset.editPayload) openPayloadDialog(button.dataset.editPayload);
    if (button.dataset.deletePayload) deletePayload(button.dataset.deletePayload);
  });
}

// 網頁載入時：整理舊設定、建立選單、綁定事件並開始狀態與封包輪詢。
function init() {
  migrateStoredDevices();
  $('#deviceProtocol').innerHTML = Object.entries(PROTOCOLS).map(([key, protocol]) => `<option value="${key}">${esc(protocol.label)}</option>`).join('');
  $('#trafficProtocol').insertAdjacentHTML('beforeend', Object.entries(PROTOCOLS).map(([key, protocol]) => `<option value="${key}">${esc(protocol.label)}</option>`).join(''));
  $('#simProtocol').innerHTML = Object.entries(PROTOCOLS).map(([key, protocol]) => `<option value="${key}">${esc(protocol.label)}</option>`).join('');
  $('#packetProtocol').insertAdjacentHTML('beforeend', Object.entries(PROTOCOLS).map(([key, protocol]) => `<option value="${key}">${esc(protocol.label)}</option>`).join(''));
  sim.target = defaultsFor(sim.protocol);
  bindEvents(); route(); renderCounters(); refreshStatus(); refreshSimPreview(); refreshPackets(); resetPoller();
}

document.addEventListener('DOMContentLoaded', init);
