const state = {
  scenario: null,
  result: null,
  compare: [],
  pickMode: null,
  compareRunId: 0,
  calculateTimer: null,
  customPoints: {
    start: null,
    finish: null
  },
  didInitialFit: false,
  map: null,
  layers: {
    base: null,
    osm: null,
    graph: null,
    route: null,
    nodes: null,
    picks: null
  }
};

const els = {
  scenarioLine: document.querySelector('#scenarioLine'),
  startSelect: document.querySelector('#startSelect'),
  finishSelect: document.querySelector('#finishSelect'),
  pickStartBtn: document.querySelector('#pickStartBtn'),
  pickFinishBtn: document.querySelector('#pickFinishBtn'),
  snapStatus: document.querySelector('#snapStatus'),
  configSelect: document.querySelector('#configSelect'),
  modeSelect: document.querySelector('#modeSelect'),
  dryMassKgInput: document.querySelector('#dryMassKgInput'),
  payloadKgInput: document.querySelector('#payloadKgInput'),
  tankLInput: document.querySelector('#tankLInput'),
  reservePctInput: document.querySelector('#reservePctInput'),
  hullLengthMInput: document.querySelector('#hullLengthMInput'),
  engineHpInput: document.querySelector('#engineHpInput'),
  propEffInput: document.querySelector('#propEffInput'),
  bsfcInput: document.querySelector('#bsfcInput'),
  planingFroudeOnInput: document.querySelector('#planingFroudeOnInput'),
  planingFroudeFullInput: document.querySelector('#planingFroudeFullInput'),
  minPlaningSpeedKmhInput: document.querySelector('#minPlaningSpeedKmhInput'),
  surfaceMuInput: document.querySelector('#surfaceMuInput'),
  calculateBtn: document.querySelector('#calculateBtn'),
  realMap: document.querySelector('#realMap'),
  routeBadge: document.querySelector('#routeBadge'),
  summaryCards: document.querySelector('#summaryCards'),
  calcInputs: document.querySelector('#calcInputs'),
  surfaceLegend: document.querySelector('#surfaceLegend'),
  surfaceTable: document.querySelector('#surfaceTable'),
  warningsList: document.querySelector('#warningsList'),
  segmentsBody: document.querySelector('#segmentsBody'),
  compareBody: document.querySelector('#compareBody')
};

function fmt(value, digits = 1) {
  return Number(value || 0).toLocaleString('ru-RU', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function listItems(items = []) {
  return items.map((item) => `<li>${item}</li>`).join('');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function formulaList(formulas = {}) {
  const labels = {
    time_segment: 'Время участка',
    froude: 'Число Froude',
    planing_threshold: 'Порог глиссирования',
    resistance: 'Сопротивление',
    power: 'Мощность',
    fuel_segment: 'Топливо участка',
    fuel_fallback: 'Страховка топлива',
    risk_segment: 'Риск участка',
    reserve_l: 'Резерв топлива',
    edge_cost: 'Стоимость ребра'
  };
  return Object.entries(formulas).map(([key, value]) => `
    <div class="formula-row">
      <dt>${labels[key] || key}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `).join('');
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok && !payload.ok) throw new Error(payload.error || 'Ошибка запроса');
  return payload;
}

function option(select, value, label = value) {
  if ([...select.options].some((item) => item.value === value)) return;
  const item = document.createElement('option');
  item.value = value;
  item.textContent = label;
  select.appendChild(item);
}

function setInput(input, value) {
  if (!input) return;
  input.value = value;
}

function numberValue(input, fallback) {
  const value = Number(input?.value);
  return Number.isFinite(value) ? value : fallback;
}

function boatParams() {
  return {
    dryMassKg: numberValue(els.dryMassKgInput, 1450),
    payloadKg: numberValue(els.payloadKgInput, 650),
    tankL: numberValue(els.tankLInput, 370),
    reserveFrac: numberValue(els.reservePctInput, 20) / 100,
    hullLengthM: numberValue(els.hullLengthMInput, 6.9),
    engineHp: numberValue(els.engineHpInput, 280),
    propEff: numberValue(els.propEffInput, 0.58),
    bsfc: numberValue(els.bsfcInput, 305),
    planingFroudeOn: numberValue(els.planingFroudeOnInput, 0.75),
    planingFroudeFull: numberValue(els.planingFroudeFullInput, 1),
    minPlaningSpeedKmh: numberValue(els.minPlaningSpeedKmhInput, 34),
    surfaceMu: numberValue(els.surfaceMuInput, 0.105)
  };
}

function appendBoatParams(params) {
  for (const [key, value] of Object.entries(boatParams())) {
    params.set(key, String(value));
  }
}

function runCalculation() {
  calculate().catch((error) => {
    state.result = { ok: false, error: error.message };
    renderSummary();
  });
}

function scheduleCalculation(delayMs = 600) {
  window.clearTimeout(state.calculateTimer);
  state.calculateTimer = window.setTimeout(runCalculation, delayMs);
}

function tuningControls() {
  return [
    els.dryMassKgInput,
    els.payloadKgInput,
    els.tankLInput,
    els.reservePctInput,
    els.hullLengthMInput,
    els.engineHpInput,
    els.propEffInput,
    els.bsfcInput,
    els.planingFroudeOnInput,
    els.planingFroudeFullInput,
    els.minPlaningSpeedKmhInput,
    els.surfaceMuInput
  ].filter(Boolean);
}

function fillControls() {
  const { raw, meta } = state.scenario;
  els.scenarioLine.textContent = `${raw.scenario.name}. ${meta.map?.area_label || raw.scenario.area}`;

  for (const node of meta.pickableNodes || meta.nodes) {
    option(els.startSelect, node);
    option(els.finishSelect, node);
  }
  els.startSelect.value = meta.start;
  els.finishSelect.value = meta.finish;

  for (const configName of Object.keys(raw.configs)) option(els.configSelect, configName);
  for (const modeName of Object.keys(raw.modes)) option(els.modeSelect, modeName, `${modeName} · ${raw.modes[modeName].desc}`);
  els.configSelect.value = 'без поддува';
  els.modeSelect.value = 'безопасный';

  setInput(els.dryMassKgInput, raw.boat?.dry_mass_kg ?? 1450);
  setInput(els.payloadKgInput, 650);
  setInput(els.tankLInput, raw.boat?.tank_l ?? 370);
  setInput(els.reservePctInput, Math.round((raw.boat?.reserve_frac_tank ?? 0.2) * 100));
  setInput(els.hullLengthMInput, raw.boat?.length_m ?? 6.9);
  setInput(els.engineHpInput, 280);
  setInput(els.propEffInput, 0.58);
  setInput(els.bsfcInput, 305);
  setInput(els.planingFroudeOnInput, 0.75);
  setInput(els.planingFroudeFullInput, 1);
  setInput(els.minPlaningSpeedKmhInput, 34);
  setInput(els.surfaceMuInput, 0.105);
}

function edgeId(from, to) {
  return [from, to].sort().join(' -> ');
}

function haversineKm(a, b) {
  const radiusKm = 6371;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(h));
}

function nearestNode(latlng) {
  const { meta } = state.scenario;
  const point = { lat: latlng.lat, lon: latlng.lng };
  let best = null;
  for (const node of meta.nodes) {
    const coord = meta.nodeCoordinates[node];
    if (!coord) continue;
    const distanceKm = haversineKm(point, coord);
    if (!best || distanceKm < best.distanceKm) best = { node, coord, distanceKm };
  }
  return best;
}

function setPickMode(mode) {
  state.pickMode = state.pickMode === mode ? null : mode;
  els.pickStartBtn.classList.toggle('active', state.pickMode === 'start');
  els.pickFinishBtn.classList.toggle('active', state.pickMode === 'finish');
  if (state.pickMode) {
    els.snapStatus.textContent = state.pickMode === 'start'
      ? 'Кликни по карте: поставим старт и привяжем к ближайшему узлу графа.'
      : 'Кликни по карте: поставим финиш и привяжем к ближайшему узлу графа.';
  } else {
    els.snapStatus.textContent = 'Клик по карте привязывает точку к ближайшему узлу графа.';
  }
}

async function applyMapPick(latlng) {
  const target = state.pickMode || (!state.customPoints.start ? 'start' : 'finish');
  const nearest = nearestNode(latlng);
  if (!nearest) return;
  state.customPoints[target] = {
    lat: latlng.lat,
    lon: latlng.lng,
    snappedNode: nearest.node,
    snappedDistanceKm: nearest.distanceKm
  };
  if (target === 'start') els.startSelect.value = nearest.node;
  if (target === 'finish') els.finishSelect.value = nearest.node;
  option(target === 'start' ? els.startSelect : els.finishSelect, nearest.node, `точка графа ${nearest.node}`);
  if (target === 'start') els.startSelect.value = nearest.node;
  if (target === 'finish') els.finishSelect.value = nearest.node;
  setPickMode(null);
  els.snapStatus.innerHTML = `
    <span class="snap-line">${target === 'start' ? 'Старт' : 'Финиш'}: поставлена точка ${fmt(latlng.lat, 5)}, ${fmt(latlng.lng, 5)}<br>
    Привязка к графу: ${nearest.node}, расстояние ${fmt(nearest.distanceKm, 2)} км.</span>
  `;
  drawMap();
  await calculate();
}

function surfaceColor(surface, active = false) {
  const palette = {
    water: '#168aad',
    ice: '#6ab7d6',
    shallow: '#d98c34',
    grass: '#6f9e3f',
    slush: '#6a8f9d',
    rocks: '#a44a3f',
    marsh: '#6b5f2a'
  };
  return active ? '#d6653b' : palette[surface] || '#66736f';
}

function renderSurfaceLegend() {
  const { raw, meta } = state.scenario;
  const stats = meta.surfaceStats || {};
  els.surfaceLegend.innerHTML = Object.entries(raw.surfaces).map(([id, surface]) => {
    const stat = stats[id] || { edge_count: 0 };
    return `
      <span class="legend-item">
        <span class="legend-dot" style="background:${surfaceColor(id)}"></span>
        ${surface.label} · ${stat.edge_count}
      </span>
    `;
  }).join('');
}

function renderSurfaceTable() {
  const { raw, meta } = state.scenario;
  const stats = meta.surfaceStats || {};
  els.surfaceTable.innerHTML = Object.entries(raw.surfaces).map(([id, surface]) => {
    const stat = stats[id] || { edge_count: 0, total_km: 0 };
    return `
      <div class="surface-row">
        <span class="legend-dot" style="background:${surfaceColor(id)}"></span>
        <div>
          <b>${surface.label}</b>
          <small>spd=${surface.spd} км/ч · k_surf=${fmt(surface.k_surf, 2)} · risk=${surface.risk} · ${surface.planing ? 'глиссирование' : 'без глиссирования'}${surface.hard ? ' · hard' : ''}</small>
        </div>
        <span>${stat.edge_count} реб. / ${fmt(stat.total_km)} км</span>
      </div>
    `;
  }).join('');
}

function humanError(error) {
  if (!error) return 'Маршрут не рассчитан';
  if (error.startsWith('Unknown start node')) {
    return 'Стартовая точка больше не входит в текущий граф. Обнови страницу или поставь старт заново на карте.';
  }
  if (error.startsWith('Unknown finish node')) {
    return 'Финишная точка больше не входит в текущий граф. Обнови страницу или поставь финиш заново на карте.';
  }
  if (error.startsWith('Route is not available')) {
    return 'Маршрут недоступен для выбранных точек и конфигурации. Вероятно, точки находятся в разных водных зонах или разделены непроходимым участком, например КрасГЭС.';
  }
  return error;
}

function initMap() {
  const { meta } = state.scenario;
  if (!window.L) {
    els.realMap.innerHTML = '<div class="map-error">Не удалось загрузить Leaflet. Проверь подключение к сети для картографической библиотеки.</div>';
    return;
  }
  if (state.map) return;

  state.map = L.map(els.realMap, {
    zoomControl: true,
    scrollWheelZoom: true,
    zoomSnap: 0.25,
    preferCanvas: true
  });

  state.layers.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    tileSize: 256,
    updateWhenIdle: true,
    keepBuffer: 4,
    opacity: 0.42,
    attribution: '© OpenStreetMap contributors'
  }).addTo(state.map);

  state.layers.base = L.layerGroup().addTo(state.map);
  state.layers.graph = L.layerGroup().addTo(state.map);
  state.layers.route = L.layerGroup().addTo(state.map);
  state.layers.nodes = L.layerGroup().addTo(state.map);
  state.layers.picks = L.layerGroup().addTo(state.map);
  state.map.on('click', (event) => {
    applyMapPick(event.latlng).catch((error) => {
      state.result = { ok: false, error: error.message };
      renderSummary();
    });
  });
  state.map.on('zoomend', () => drawMap());
  drawLocalBaseMap();
  state.map.fitBounds(meta.map.bounds, { padding: [24, 24], animate: false });
  state.didInitialFit = true;
  setTimeout(() => state.map.invalidateSize(), 80);
  setTimeout(() => state.map.invalidateSize(), 350);
}

function drawLocalBaseMap() {
  const { meta, surfaceZones } = state.scenario;
  state.layers.base.clearLayers();

  for (const zone of surfaceZones.features || []) {
    const surface = zone.properties.surface;
    const coords = zone.geometry.coordinates.map((ring) => ring.map(([lon, lat]) => [lat, lon]));
    L.polygon(coords, {
      color: surfaceColor(surface),
      fillColor: surfaceColor(surface),
      fillOpacity: surface === 'ice' ? 0.28 : 0.42,
      weight: 2,
      interactive: true
    })
      .bindTooltip(`${zone.properties.label}<br>surface=${surface}`, { sticky: true })
      .addTo(state.layers.base);
  }

  L.control.scale({ imperial: false }).addTo(state.map);
}

function drawMap() {
  const { raw, meta } = state.scenario;
  if (!state.map) initMap();
  if (!state.map) return;

  state.layers.graph.clearLayers();
  state.layers.route.clearLayers();
  state.layers.nodes.clearLayers();
  state.layers.picks.clearLayers();

  const activeEdges = new Set((state.result?.route?.segments || []).map((segment) => edgeId(segment.from, segment.to)));
  const activeNodes = new Set(state.result?.route?.nodes || []);

  for (const edge of meta.edges) {
    const from = meta.nodeCoordinates[edge.from];
    const to = meta.nodeCoordinates[edge.to];
    const surface = raw.surfaces[edge.surface];
    if (!from || !to || !surface) continue;
    const isActive = activeEdges.has(edgeId(edge.from, edge.to));
    const layer = L.polyline([[from.lat, from.lon], [to.lat, to.lon]], {
      color: surfaceColor(edge.surface, isActive),
      weight: isActive ? 4.5 : 0.8,
      opacity: isActive ? 0.92 : 0.22,
      dashArray: surface.hard ? '10 8' : null
    });
    layer.bindTooltip(`${edge.from} → ${edge.to}<br>${edge.km} км · ${surface.label}<br>risk=${surface.risk}, k_surf=${surface.k_surf}`, {
      sticky: true
    });
    layer.addTo(isActive ? state.layers.route : state.layers.graph);
  }

  for (const node of meta.nodes) {
    const coord = meta.nodeCoordinates[node];
    if (!coord) continue;
    const isAnchor = (meta.pickableNodes || []).includes(node);
    const isActive = activeNodes.has(node);
    const showDenseNodes = state.map.getZoom() >= 12;
    if (!isAnchor && !isActive && !showDenseNodes) continue;
    const radius = isAnchor ? (isActive ? 4.4 : 3.8) : (isActive ? 1.15 : 0.45);
    const marker = L.circleMarker([coord.lat, coord.lon], {
      radius,
      color: isActive ? '#d6653b' : '#0d7772',
      fillColor: isActive ? '#f6d9c9' : (isAnchor ? '#ffffff' : '#0d7772'),
      fillOpacity: isAnchor || isActive ? 0.95 : 0.22,
      opacity: isAnchor || isActive ? 0.95 : 0.28,
      weight: isActive ? 1.6 : (isAnchor ? 2 : 0)
    });
    if (isAnchor || isActive) {
      marker.bindTooltip(`${node}<br>${coord.source}`, { permanent: false, sticky: true });
    }
    marker.addTo(state.layers.nodes);
  }

  drawPickMarkers();

  if (state.result?.ok) {
    const bounds = state.result.route.nodes
      .map((node) => meta.nodeCoordinates[node])
      .filter(Boolean)
      .map((coord) => [coord.lat, coord.lon]);
    if (bounds.length > 1 && !state.didInitialFit) {
      state.map.fitBounds(bounds, { padding: [36, 36], animate: false });
      state.didInitialFit = true;
    }
  }
}

function drawPickMarkers() {
  const { meta } = state.scenario;
  for (const [target, pick] of Object.entries(state.customPoints)) {
    if (!pick) continue;
    const snap = meta.nodeCoordinates[pick.snappedNode];
    const color = target === 'start' ? '#0d7772' : '#d6653b';
    L.circleMarker([pick.lat, pick.lon], {
      radius: 7,
      color,
      fillColor: color,
      fillOpacity: 0.85,
      weight: 2
    })
      .bindTooltip(`${target === 'start' ? 'Пользовательский старт' : 'Пользовательский финиш'}<br>Привязано к: ${pick.snappedNode}`)
      .addTo(state.layers.picks);
    if (snap) {
      L.polyline([[pick.lat, pick.lon], [snap.lat, snap.lon]], {
        color,
        weight: 2,
        opacity: 0.75,
        dashArray: '4 6'
      }).addTo(state.layers.picks);
    }
  }
}

function renderSummary() {
  const result = state.result;
  if (!result?.ok) {
    const message = humanError(result?.error);
    els.routeBadge.textContent = message;
    els.summaryCards.innerHTML = '';
    els.calcInputs.innerHTML = '';
    els.segmentsBody.innerHTML = '';
    els.warningsList.innerHTML = `<li>${message}</li>`;
    return;
  }

  const totals = result.totals;
  const routeNodes = result.route.nodes;
  const routeLabel = routeNodes.length > 6
    ? `${routeNodes[0]} → ${routeNodes[routeNodes.length - 1]} · ${result.route.segments.length} сегм.`
    : routeNodes.join(' → ');
  els.routeBadge.textContent = routeLabel;
  const metrics = [
    ['Длина', `${fmt(totals.distance_km)} км`],
    ['Время', `${fmt(totals.time_min, 0)} мин`],
    ['Топливо', `${fmt(totals.fuel_l)} л`],
    ['Остаток', `${fmt(totals.remainder_l)} л`],
    ['Риск', fmt(totals.risk_points)],
    ['Резерв', `${fmt(totals.reserve_l)} л`]
  ];
  els.summaryCards.innerHTML = metrics.map(([label, value]) => `
    <div class="metric"><span>${label}</span><strong>${value}</strong></div>
  `).join('');

  const routeAdvice = result.route_advice || [];
  els.warningsList.innerHTML = listItems([...result.warnings, ...routeAdvice.slice(0, 5)]);
  renderCalculationInputs(result);
  els.segmentsBody.innerHTML = result.route.segments.map((segment) => `
    <tr>
      <td>${segment.from}</td>
      <td>${segment.to}</td>
      <td>${segment.surface_label}</td>
      <td>${fmt(segment.km)}</td>
      <td>${fmt(segment.time_h * 60, 0)}</td>
      <td>${fmt(segment.fuel_l)}</td>
      <td>${fmt(segment.risk_points)}</td>
      <td class="used-values">
        расчёт ${fmt(segment.speed_kmh, 0)} → рек. ${fmt(segment.recommended_speed_kmh || segment.speed_kmh, 0)} км/ч<br>
        темп: <b>${segment.pace_label || 'умеренно'}</b> · ${segment.motion_label || (segment.planing ? 'глиссирование' : 'водоизмещающий режим')}<br>
        Fn=${fmt(segment.froude, 2)} · P=${fmt(segment.power_kw, 0)} кВт · ${fmt(segment.fuel_l_h, 1)} л/ч<br>
        R=${fmt(segment.resistance_n, 0)} Н · ${fmt(segment.fuel_l_per_km, 2)} л/км<br>
        k_surf=${fmt(segment.k_surf, 2)} · risk=${fmt(segment.surface_risk, 0)}<br>
        ${segment.narrow_waterway ? '<span class="tag slow">узкая река</span>' : ''}
        ${segment.cavitation_risk && segment.cavitation_risk !== 'low' ? `<span class="tag warn">кавитация/срыв: ${segment.cavitation_label}</span>` : ''}
        ${segment.hard ? '<span class="tag warn">сложно</span>' : ''}
        <small>${(segment.speed_notes || []).slice(0, 2).join('; ')}</small>
      </td>
    </tr>
  `).join('');
}

function renderCalculationInputs(result) {
  const inputs = result.calculation_inputs;
  if (!inputs) {
    els.calcInputs.innerHTML = '<p class="subtle">Детали расчёта не пришли от движка.</p>';
    return;
  }
  els.calcInputs.innerHTML = `
    <div class="calc-box">
      <b>Лодка</b>
      <p>Raptor 650 · масса ${fmt(inputs.boat.total_mass_kg, 0)} кг · бак ${fmt(inputs.boat.tank_l, 0)} л · резерв ${fmt(inputs.boat.reserve_frac_tank * 100, 0)}%<br>
      корпус ${fmt(inputs.boat.hull_length_m, 1)} м · двигатель ${fmt(inputs.boat.max_engine_hp, 0)} л.с. · КПД ${fmt(inputs.boat.propulsive_efficiency, 2)} · BSFC ${fmt(inputs.boat.bsfc_g_per_kwh, 0)} г/кВт·ч</p>
    </div>
    <div class="calc-box">
      <b>Глиссирование</b>
      <p>Порог расчёта ${fmt(inputs.boat.planing_threshold_kmh, 0)} км/ч · Fn перехода ${fmt(inputs.boat.planing_froude_on, 2)} · Fn глиссирования ${fmt(inputs.boat.planing_froude_full, 2)}<br>
      Cd водоизм. ${fmt(inputs.boat.displacement_cd, 2)} · Cd глисс. ${fmt(inputs.boat.planing_cd, 2)} · μ поверхности ${fmt(inputs.boat.surface_mu, 3)}</p>
    </div>
    <div class="calc-box">
      <b>Конфигурация</b>
      <p>${inputs.config.name} · k_load=${fmt(inputs.config.k_load, 2)} · сложные участки ${inputs.config.allow_hard ? 'разрешены' : 'запрещены'}</p>
    </div>
    <div class="calc-box">
      <b>Режим</b>
      <p>${inputs.mode.name} · цель: ${inputs.mode.objective} · k_mode=${fmt(inputs.mode.k_mode, 2)}<br>${inputs.mode.desc}</p>
    </div>
    <div class="calc-box">
      <b>Формулы</b>
      <dl class="formula-list">${formulaList(inputs.formulas)}</dl>
    </div>
    <div class="calc-box">
      <b>Скорость и режим движения</b>
      <p>${inputs.speed_policy?.base || 'Скорость корректируется под выбранный режим.'}<br>
      ${inputs.speed_policy?.narrow_waterway || 'На узких участках скорость снижается.'}<br>
      ${inputs.speed_policy?.motion_states || 'Режим движения выбирается по поверхности и риску.'}</p>
    </div>
    ${(result.route_advice || []).length ? `
      <div class="calc-box">
        <b>Рекомендации по маршруту</b>
        <ul>${listItems((result.route_advice || []).slice(0, 4))}</ul>
      </div>
    ` : ''}
  `;
}

async function calculate() {
  els.calculateBtn.disabled = true;
  els.calculateBtn.textContent = 'Считаю маршрут...';
  const params = new URLSearchParams({
    start: els.startSelect.value,
    finish: els.finishSelect.value,
    config: els.configSelect.value,
    mode: els.modeSelect.value
  });
  appendBoatParams(params);
  try {
    state.result = await fetchJson(`/api/route?${params}`);
    renderSummary();
    drawMap();
    compareAll().catch((error) => {
      els.compareBody.innerHTML = `<tr><td colspan="7">${error.message}</td></tr>`;
    });
  } finally {
    els.calculateBtn.disabled = false;
    els.calculateBtn.textContent = 'Рассчитать маршрут';
  }
}

async function compareAll() {
  const runId = ++state.compareRunId;
  const { raw } = state.scenario;
  const rows = [];
  els.compareBody.innerHTML = '<tr><td colspan="7">Сравниваю режимы...</td></tr>';
  for (const config of Object.keys(raw.configs)) {
    for (const mode of Object.keys(raw.modes)) {
      if (runId !== state.compareRunId) return;
      const params = new URLSearchParams({
        start: els.startSelect.value,
        finish: els.finishSelect.value,
        config,
        mode
      });
      appendBoatParams(params);
      const result = await fetchJson(`/api/route?${params}`);
      rows.push({ config, mode, result });
    }
  }
  if (runId !== state.compareRunId) return;
  state.compare = rows;
  els.compareBody.innerHTML = rows.map(({ config, mode, result }) => {
    if (!result.ok) {
      return `<tr><td>${config}</td><td>${mode}</td><td colspan="5">${humanError(result.error)}</td></tr>`;
    }
    return `
      <tr>
        <td>${config}</td>
        <td>${mode}</td>
        <td class="route-path">${result.route.nodes.join(' → ')}</td>
        <td>${fmt(result.totals.distance_km)}</td>
        <td>${fmt(result.totals.time_min, 0)}</td>
        <td>${fmt(result.totals.fuel_l)}</td>
        <td>${fmt(result.totals.risk_points)}</td>
      </tr>
    `;
  }).join('');
}

async function init() {
  state.scenario = await fetchJson('/api/scenario');
  fillControls();
  renderSurfaceLegend();
  renderSurfaceTable();
  initMap();
  drawMap();
  await calculate();
}

els.calculateBtn.addEventListener('click', () => {
  runCalculation();
});

els.pickStartBtn.addEventListener('click', () => setPickMode('start'));
els.pickFinishBtn.addEventListener('click', () => setPickMode('finish'));

for (const control of [
  els.startSelect,
  els.finishSelect,
  els.configSelect,
  els.modeSelect,
  els.dryMassKgInput,
  els.payloadKgInput,
  els.tankLInput,
  els.reservePctInput,
  els.hullLengthMInput,
  els.engineHpInput,
  els.propEffInput,
  els.bsfcInput,
  els.planingFroudeOnInput,
  els.planingFroudeFullInput,
  els.minPlaningSpeedKmhInput,
  els.surfaceMuInput
]) {
  if (!control) continue;
  control.addEventListener('change', () => {
    runCalculation();
  });
}

for (const control of tuningControls()) {
  control.addEventListener('input', () => scheduleCalculation());
}

init().catch((error) => {
  els.scenarioLine.textContent = error.message;
});
