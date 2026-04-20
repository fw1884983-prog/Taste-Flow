const audioFiles = ["A.mp3", "B.mp3", "C.mp3", "D.mp3", "E.mp3", "F.mp3", "G.mp3", "H.mp3", "I.mp3", "J.mp3", "K.mp3", "L.mp3"];
const PANEL_W = 386;
const PANEL_H = 276;

const NODE_DEFS = {
  lpf: {
    title: "低通滤波 LPF",
    colors: ["green"],
    audioParam: "BiquadFilterNode.frequency",
    physics: "遮罩覆盖区域为被滤掉频段，拖动边缘即截止频率。",
  },
  hpf: {
    title: "高通滤波 HPF",
    colors: ["green", "pink"],
    audioParam: "BiquadFilterNode.frequency",
    physics: "左侧低频遮罩，边缘坐标即高通截止点。",
  },
  frequency: {
    title: "频率 Peak",
    colors: ["blue", "pink", "yellow"],
    audioParam: "frequency(X) / gain(Y) / Q(宽度)",
    physics: "水滴位置决定频点，垂直决定增益，宽度决定精准度。",
  },
  centroid: {
    title: "频谱重心",
    colors: ["pink", "yellow"],
    audioParam: "Highshelf.gain(联动反向)",
    physics: "天平倾角改变高低频能量分布，向上更亮，向下更暗。",
  },
  adsr: {
    title: "ADSR",
    colors: ["blue"],
    audioParam: "AudioParam.linearRampToValueAtTime",
    physics: "顶点 X 为时间，Y 为振幅，直接定义包络轨迹。",
  },
  distortion: {
    title: "波形畸变",
    colors: ["blue", "pink"],
    audioParam: "WaveShaperNode.curve",
    physics: "压扁波形框即削顶，越扁谐波越多，质感更燥。",
  },
  compression: {
    title: "动态挤压",
    colors: ["green"],
    audioParam: "DynamicsCompressor.threshold / ratio",
    physics: "弹性圈越扁动态越小，声音更紧实。",
  },
  reverb: {
    title: "混响",
    colors: ["green"],
    audioParam: "Convolver / Reverb.decay",
    physics: "同心圆扩散半径越大，反射尾音越长。",
  },
  drywet: {
    title: "干湿比",
    colors: ["green", "blue"],
    audioParam: "Dry.gain / Wet.gain",
    physics: "重叠层透明度决定原始与处理信号的混合比例。",
  },
  phase: {
    title: "相位移动",
    colors: ["pink"],
    audioParam: "Phaser.frequency / depth",
    physics: "旋转重影拨盘，偏移速度越快，撕裂感越明显。",
  },
  grain: {
    title: "时间切片",
    colors: ["pink"],
    audioParam: "Grain.playbackRate / duration",
    physics: "栅格间距越密，切片越碎，颗粒感越强。",
  },
};

const workspace = document.getElementById("workspace");
const world = document.getElementById("world");
const panelLayer = document.getElementById("panelLayer");
const sidebar = document.getElementById("sidebar");
const edgeLayer = document.getElementById("edgeLayer");
const nodeMenu = document.getElementById("nodeMenu");
const nodeMenuToggle = document.getElementById("nodeMenuToggle");
const presetMenu = document.getElementById("presetMenu");
const presetMenuToggle = document.getElementById("presetMenuToggle");
const audioNode = document.getElementById("audioNode");
const audioHub = document.getElementById("audioHub");
const audioPickerBtn = document.getElementById("audioPickerBtn");
const audioDialog = document.getElementById("audioDialog");
const audioSelect = document.getElementById("audioSelect");
const confirmAudio = document.getElementById("confirmAudio");
const playIcon = document.getElementById("playIcon");
const hubLabel = document.getElementById("hubLabel");
const player = document.getElementById("player");

let selectedAudio = "";
let panelCounter = 1;
let edges = [];

let worldOffset = { x: 0, y: 0 };
let isSpacePressed = false;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panAnchor = { x: 0, y: 0 };

let portDrag = null;
let templateDrag = null;
let panelDrag = null;
let bubbleDrag = null;
let didBubbleDrag = false;

const colorMap = {
  green: "#b9d7a8",
  pink: "#e7b4c2",
  yellow: "#e6cb88",
  blue: "#b3cfee",
};

const edgeKey = (a, b, c) => `${a}|${b}|${c}`;
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

function buildAudioOptions() {
  audioFiles.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    audioSelect.appendChild(opt);
  });
}

function applyWorldTransform() {
  world.style.transform = `translate(${worldOffset.x}px, ${worldOffset.y}px)`;
  renderEdges();
}

function centerWorld() {
  const sidebarWidth = sidebar?.offsetWidth || 0;
  const viewportWidth = Math.max(workspace.clientWidth - sidebarWidth, 0);
  worldOffset = {
    x: sidebarWidth + (viewportWidth - 2200) / 2,
    y: (workspace.clientHeight - 1500) / 2,
  };
  applyWorldTransform();
}

function setPanelState(button, panel, open, closedLabel, openedLabel) {
  panel.classList.toggle("is-hidden", !open);
  panel.setAttribute("aria-hidden", String(!open));
  button.setAttribute("aria-expanded", String(open));
  button.textContent = open ? openedLabel : closedLabel;
}

function wireMenus() {
  setPanelState(nodeMenuToggle, nodeMenu, false, "参数节点组件", "参数节点组件（收起）");
  setPanelState(presetMenuToggle, presetMenu, false, "预设节点组件", "预设节点组件（收起）");

  nodeMenuToggle.addEventListener("click", () => {
    const open = nodeMenuToggle.getAttribute("aria-expanded") === "true";
    setPanelState(nodeMenuToggle, nodeMenu, !open, "参数节点组件", "参数节点组件（收起）");
  });
  presetMenuToggle.addEventListener("click", () => {
    const open = presetMenuToggle.getAttribute("aria-expanded") === "true";
    setPanelState(presetMenuToggle, presetMenu, !open, "预设节点组件", "预设节点组件（收起）");
  });
}

function decorateTemplateMarkers() {
  document.querySelectorAll(".node-template").forEach((card) => {
    const type = card.dataset.nodeType;
    const def = NODE_DEFS[type];
    if (!def || !def.colors?.length) return;
    const marker = document.createElement("span");
    marker.className = "template-markers";
    marker.innerHTML = def.colors.map((c) => `<i class="template-dot ${c}"></i>`).join("");
    card.appendChild(marker);
  });
}

function getPoint(el) {
  const a = el.getBoundingClientRect();
  const b = workspace.getBoundingClientRect();
  return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
}

function makeLine(from, to, color) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(from.x));
  line.setAttribute("y1", String(from.y));
  line.setAttribute("x2", String(to.x));
  line.setAttribute("y2", String(to.y));
  line.setAttribute("stroke", colorMap[color] || "#9fa6b2");
  line.setAttribute("stroke-width", "3");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("opacity", "0.92");
  return line;
}

function renderEdges() {
  edgeLayer.innerHTML = "";

  edges.forEach((edge) => {
    const fromEl = document.querySelector(`[data-port="${edge.from}"]`);
    const toEl = document.querySelector(`[data-port="${edge.to}"]`);
    if (!fromEl || !toEl) return;
    edgeLayer.appendChild(makeLine(getPoint(fromEl), getPoint(toEl), edge.color));
  });

  if (portDrag) {
    edgeLayer.appendChild(makeLine(getPoint(portDrag.fromEl), portDrag.cursor, portDrag.color));
  }
}

function removeEdgesForPrefix(prefix) {
  edges = edges.filter((edge) => !edge.from.startsWith(prefix) && !edge.to.startsWith(prefix));
  renderEdges();
}

function startPortDrag(fromEl) {
  portDrag = {
    fromEl,
    from: fromEl.dataset.port,
    color: fromEl.dataset.color,
    cursor: getPoint(fromEl),
  };
  renderEdges();
}

function finishPortDrag(targetPort) {
  if (!portDrag) return;

  if (!targetPort) {
    portDrag = null;
    renderEdges();
    return;
  }

  const from = portDrag.from;
  const to = targetPort.dataset.port;
  const color = portDrag.color;
  const targetColor = targetPort.dataset.color;
  const fromKind = portDrag.fromEl.dataset.nodeKind || "";
  const toKind = targetPort.dataset.nodeKind || "";

  if (!from || !to || from === to) {
    portDrag = null;
    renderEdges();
    return;
  }

  const isPanelSystemPair =
    (fromKind === "panel" && toKind === "system") ||
    (fromKind === "system" && toKind === "panel");

  const involvesPanel = fromKind === "panel" || toKind === "panel";
  if (involvesPanel && !isPanelSystemPair) {
    portDrag = null;
    renderEdges();
    return;
  }

  const isSystemAudioPair =
    (fromKind === "system" && toKind === "audio") ||
    (fromKind === "audio" && toKind === "system");

  if ((fromKind === "system" || fromKind === "audio") && (toKind === "system" || toKind === "audio") && !isSystemAudioPair) {
    portDrag = null;
    renderEdges();
    return;
  }

  if (targetColor !== color) {
    targetPort.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.25)" }, { transform: "scale(1)" }],
      { duration: 200 },
    );
    portDrag = null;
    renderEdges();
    return;
  }

  const k1 = edgeKey(from, to, color);
  const k2 = edgeKey(to, from, color);
  const exists = edges.some((edge) => {
    const key = edgeKey(edge.from, edge.to, edge.color);
    return key === k1 || key === k2;
  });
  if (!exists) edges.push({ from, to, color });
  portDrag = null;
  renderEdges();
}

function worldPointFromClient(clientX, clientY) {
  const r = workspace.getBoundingClientRect();
  return {
    x: clientX - r.left - worldOffset.x,
    y: clientY - r.top - worldOffset.y,
  };
}

function createSvg(w, h) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.classList.add("panel-widget");
  return svg;
}

function addPanelPorts(panel, colors, prefix) {
  const portColors = colors?.length ? colors : ["blue"];
  const total = portColors.length;
  portColors.forEach((color, index) => {
    const ratio = total === 1 ? 0.5 : index / (total - 1);
    const y = 24 + ratio * 52;
    const port = document.createElement("button");
    port.className = `port panel-port panel-port-right ${color}`;
    port.style.top = `${y}%`;
    port.dataset.port = `${prefix}-${color}`;
    port.dataset.color = color;
    port.dataset.nodeKind = "panel";
    panel.append(port);
  });
}

function initAdsr(host, valueEl) {
  const svg = createSvg(386, 170);
  host.appendChild(svg);
  const p = {
    s: { x: 20, y: 150 },
    a: { x: 98, y: 24 },
    d: { x: 154, y: 76 },
    u: { x: 266, y: 76 },
    r: { x: 336, y: 150 },
  };
  const poly = document.createElementNS("http://www.w3.org/2000/svg", "path");
  poly.setAttribute("fill", "rgba(77,143,255,0.22)");
  poly.setAttribute("stroke", "#2d73d4");
  poly.setAttribute("stroke-width", "2.4");
  svg.appendChild(poly);
  const keys = ["a", "d", "u", "r"];
  const handles = keys.map((k) => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.dataset.k = k;
    c.setAttribute("r", "6");
    c.setAttribute("fill", "#0f1b2a");
    svg.appendChild(c);
    return c;
  });
  let active = "";

  const redraw = () => {
    poly.setAttribute(
      "d",
      `M ${p.s.x} ${p.s.y} L ${p.a.x} ${p.a.y} L ${p.d.x} ${p.d.y} L ${p.u.x} ${p.u.y} L ${p.r.x} ${p.r.y} L ${p.r.x} ${p.s.y} L ${p.s.x} ${p.s.y} Z`,
    );
    handles.forEach((h) => {
      h.setAttribute("cx", String(p[h.dataset.k].x));
      h.setAttribute("cy", String(p[h.dataset.k].y));
    });
    valueEl.textContent = `A:${p.a.x - p.s.x} D:${p.d.x - p.a.x} S:${Math.round((150 - p.u.y) / 1.4)} R:${p.r.x - p.u.x}`;
  };
  svg.addEventListener("mousedown", (e) => {
    const h = e.target.closest("circle");
    if (!h) return;
    e.stopPropagation();
    active = h.dataset.k;
  });
  window.addEventListener("mousemove", (e) => {
    if (!active) return;
    const r = svg.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (active === "a") {
      p.a.x = clamp(x, 58, 126);
      p.a.y = clamp(y, 10, 118);
    } else if (active === "d") {
      p.d.x = clamp(x, p.a.x + 20, 230);
      p.d.y = clamp(y, 42, 128);
      p.u.x = Math.max(p.u.x, p.d.x + 30);
      p.u.y = p.d.y;
    } else if (active === "u") {
      p.u.x = clamp(x, p.d.x + 30, 300);
      p.u.y = clamp(y, 42, 128);
      p.d.y = p.u.y;
    } else if (active === "r") {
      p.r.x = clamp(x, p.u.x + 24, 360);
    }
    redraw();
  });
  window.addEventListener("mouseup", () => {
    active = "";
  });
  redraw();
}

function initFilter(host, valueEl, mode) {
  const svg = createSvg(386, 170);
  host.appendChild(svg);
  const axis = document.createElementNS("http://www.w3.org/2000/svg", "path");
  axis.setAttribute("d", "M 26 20 L 26 144 L 360 144");
  axis.setAttribute("stroke", "#172030");
  axis.setAttribute("stroke-width", "2");
  axis.setAttribute("fill", "none");
  svg.appendChild(axis);
  const mask = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  mask.setAttribute("y", "22");
  mask.setAttribute("height", "122");
  mask.setAttribute("fill", "rgba(131,194,109,0.35)");
  svg.appendChild(mask);
  const edge = document.createElementNS("http://www.w3.org/2000/svg", "line");
  edge.setAttribute("y1", "20");
  edge.setAttribute("y2", "144");
  edge.setAttribute("stroke", "#253248");
  edge.setAttribute("stroke-width", "3");
  svg.appendChild(edge);

  let x = mode === "lpf" ? 210 : 150;
  let dragging = false;
  const redraw = () => {
    x = clamp(x, 42, 350);
    if (mode === "lpf") {
      mask.setAttribute("x", String(x));
      mask.setAttribute("width", String(360 - x));
    } else {
      mask.setAttribute("x", "26");
      mask.setAttribute("width", String(x - 26));
    }
    edge.setAttribute("x1", String(x));
    edge.setAttribute("x2", String(x));
    const min = 20;
    const max = 20000;
    const ratio = (x - 26) / 334;
    const hz = Math.round(min * ((max / min) ** clamp(ratio, 0, 1)));
    valueEl.textContent = `Cutoff: ${hz} Hz`;
  };
  svg.addEventListener("mousedown", (e) => {
    dragging = true;
    x = e.offsetX;
    redraw();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const r = svg.getBoundingClientRect();
    x = e.clientX - r.left;
    redraw();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });
  redraw();
}

function initPeak(host, valueEl) {
  const svg = createSvg(386, 170);
  host.appendChild(svg);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  line.setAttribute("points", "28,128 90,116 154,132 228,102 356,128");
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "#58657b");
  line.setAttribute("stroke-width", "2");
  svg.appendChild(line);
  const drop = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
  drop.setAttribute("fill", "rgba(245,105,140,0.75)");
  drop.setAttribute("stroke", "#8a2f4a");
  drop.setAttribute("stroke-width", "2");
  svg.appendChild(drop);
  let cx = 194;
  let cy = 78;
  let dragging = false;
  const redraw = () => {
    cx = clamp(cx, 44, 352);
    cy = clamp(cy, 36, 132);
    drop.setAttribute("cx", String(cx));
    drop.setAttribute("cy", String(cy));
    const q = 1 + ((132 - cy) / 96) * 11;
    drop.setAttribute("rx", String(clamp((132 - cy) / 4.2, 10, 24)));
    drop.setAttribute("ry", "14");
    valueEl.textContent = `frequency:${Math.round(cx * 38)}Hz gain:${Math.round((132 - cy) / 3)} Q:${q.toFixed(1)}`;
  };
  drop.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    dragging = true;
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const r = svg.getBoundingClientRect();
    cx = e.clientX - r.left;
    cy = e.clientY - r.top;
    redraw();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });
  redraw();
}

function initCentroid(host, valueEl) {
  const svg = createSvg(386, 170);
  host.appendChild(svg);
  const pivot = { x: 194, y: 94 };
  const rod = document.createElementNS("http://www.w3.org/2000/svg", "line");
  rod.setAttribute("stroke", "#1a263a");
  rod.setAttribute("stroke-width", "6");
  rod.setAttribute("stroke-linecap", "round");
  svg.appendChild(rod);
  const base = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  base.setAttribute("cx", String(pivot.x));
  base.setAttribute("cy", String(pivot.y + 24));
  base.setAttribute("r", "11");
  base.setAttribute("fill", "#334663");
  svg.appendChild(base);
  const knob = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  knob.setAttribute("r", "9");
  knob.setAttribute("fill", "#f3b33d");
  knob.setAttribute("stroke", "#8a5f18");
  knob.setAttribute("stroke-width", "2");
  svg.appendChild(knob);
  let angle = 0;
  let dragging = false;
  const redraw = () => {
    const rad = (angle * Math.PI) / 180;
    const len = 120;
    const x1 = pivot.x - Math.cos(rad) * len;
    const y1 = pivot.y + Math.sin(rad) * len;
    const x2 = pivot.x + Math.cos(rad) * len;
    const y2 = pivot.y - Math.sin(rad) * len;
    rod.setAttribute("x1", String(x1));
    rod.setAttribute("y1", String(y1));
    rod.setAttribute("x2", String(x2));
    rod.setAttribute("y2", String(y2));
    knob.setAttribute("cx", String(x2));
    knob.setAttribute("cy", String(y2));
    valueEl.textContent = `Tilt:${angle.toFixed(1)}° HighGain:${(angle / 3).toFixed(1)}dB`;
  };
  knob.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    dragging = true;
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const r = svg.getBoundingClientRect();
    const y = e.clientY - r.top;
    angle = clamp((pivot.y - y) / 2.2, -30, 30);
    redraw();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });
  redraw();
}

function initDistortion(host, valueEl) {
  const svg = createSvg(386, 170);
  host.appendChild(svg);
  const frame = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  frame.setAttribute("x", "34");
  frame.setAttribute("y", "24");
  frame.setAttribute("width", "320");
  frame.setAttribute("height", "122");
  frame.setAttribute("fill", "none");
  frame.setAttribute("stroke", "#1f2b3d");
  frame.setAttribute("stroke-width", "2");
  svg.appendChild(frame);
  const wave = document.createElementNS("http://www.w3.org/2000/svg", "path");
  wave.setAttribute("fill", "none");
  wave.setAttribute("stroke", "#ff8a4f");
  wave.setAttribute("stroke-width", "3");
  svg.appendChild(wave);
  const handle = document.createElementNS("http://www.w3.org/2000/svg", "line");
  handle.setAttribute("x1", "356");
  handle.setAttribute("x2", "356");
  handle.setAttribute("stroke", "#27344a");
  handle.setAttribute("stroke-width", "4");
  svg.appendChild(handle);
  let crush = 0.4;
  let dragging = false;
  const redraw = () => {
    const up = 44 + crush * 45;
    const down = 126 - crush * 45;
    handle.setAttribute("y1", String(up));
    handle.setAttribute("y2", String(down));
    const pts = [];
    for (let x = 38; x <= 350; x += 3) {
      const t = (x - 38) / 48;
      let s = Math.sin(t);
      const threshold = 1 - crush * 0.85;
      s = clamp(s, -threshold, threshold) / threshold;
      pts.push(`${x},${86 - s * 46}`);
    }
    wave.setAttribute("d", `M ${pts.join(" L ")}`);
    valueEl.textContent = `Drive:${Math.round(crush * 100)}%`;
  };
  handle.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    dragging = true;
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const r = svg.getBoundingClientRect();
    const y = e.clientY - r.top;
    crush = clamp((126 - y) / 84, 0.05, 1);
    redraw();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });
  redraw();
}

function initCompression(host, valueEl) {
  const svg = createSvg(386, 170);
  host.appendChild(svg);
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
  ring.setAttribute("cx", "194");
  ring.setAttribute("cy", "86");
  ring.setAttribute("fill", "rgba(145,196,124,0.2)");
  ring.setAttribute("stroke", "#4f8d47");
  ring.setAttribute("stroke-width", "5");
  svg.appendChild(ring);
  const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  handle.setAttribute("r", "9");
  handle.setAttribute("fill", "#26492f");
  svg.appendChild(handle);
  let rx = 92;
  let ry = 56;
  let dragging = false;
  const redraw = () => {
    ring.setAttribute("rx", String(rx));
    ring.setAttribute("ry", String(ry));
    handle.setAttribute("cx", String(194 + rx));
    handle.setAttribute("cy", String(86 - ry));
    valueEl.textContent = `threshold:${(-60 + (ry / 56) * 54).toFixed(1)}dB ratio:${(rx / ry).toFixed(2)}`;
  };
  handle.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    dragging = true;
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const r = svg.getBoundingClientRect();
    rx = clamp(e.clientX - r.left - 194, 44, 124);
    ry = clamp(86 - (e.clientY - r.top), 20, 74);
    redraw();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });
  redraw();
}

function initReverb(host, valueEl) {
  const svg = createSvg(386, 170);
  host.appendChild(svg);
  const rings = [];
  for (let i = 0; i < 5; i += 1) {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", "192");
    c.setAttribute("cy", "84");
    c.setAttribute("fill", "none");
    c.setAttribute("stroke", "#5d85ff");
    c.setAttribute("stroke-width", "2");
    svg.appendChild(c);
    rings.push(c);
  }
  const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  handle.setAttribute("r", "8");
  handle.setAttribute("fill", "#2f58d8");
  svg.appendChild(handle);
  let radius = 52;
  let dragging = false;
  const redraw = () => {
    rings.forEach((ring, i) => {
      ring.setAttribute("r", String(radius + i * 12));
      ring.setAttribute("opacity", String(Math.max(0.2, 0.9 - i * 0.15)));
    });
    handle.setAttribute("cx", String(192 + radius));
    handle.setAttribute("cy", "84");
    valueEl.textContent = `decay:${(radius / 20).toFixed(2)}s`;
  };
  handle.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    dragging = true;
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const r = svg.getBoundingClientRect();
    radius = clamp(e.clientX - r.left - 192, 20, 96);
    redraw();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });
  redraw();
}

function initDryWet(host, valueEl) {
  const svg = createSvg(386, 170);
  host.appendChild(svg);
  const dry = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  dry.setAttribute("x", "52");
  dry.setAttribute("y", "36");
  dry.setAttribute("width", "170");
  dry.setAttribute("height", "108");
  dry.setAttribute("fill", "#405678");
  svg.appendChild(dry);
  const wet = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  wet.setAttribute("x", "126");
  wet.setAttribute("y", "26");
  wet.setAttribute("width", "186");
  wet.setAttribute("height", "122");
  wet.setAttribute("fill", "#89b3ff");
  svg.appendChild(wet);
  const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  handle.setAttribute("cx", "338");
  handle.setAttribute("r", "8");
  handle.setAttribute("fill", "#1f2b3f");
  svg.appendChild(handle);
  let wetMix = 0.45;
  let dragging = false;
  const redraw = () => {
    const y = 136 - wetMix * 86;
    handle.setAttribute("cy", String(y));
    wet.setAttribute("opacity", String(0.2 + wetMix * 0.8));
    valueEl.textContent = `Dry:${Math.round((1 - wetMix) * 100)}% Wet:${Math.round(wetMix * 100)}%`;
  };
  handle.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    dragging = true;
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const r = svg.getBoundingClientRect();
    wetMix = clamp((136 - (e.clientY - r.top)) / 86, 0, 1);
    redraw();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });
  redraw();
}

function initPhase(host, valueEl) {
  const svg = createSvg(386, 170);
  host.appendChild(svg);
  const a = document.createElementNS("http://www.w3.org/2000/svg", "path");
  a.setAttribute("fill", "none");
  a.setAttribute("stroke", "#28a5ff");
  a.setAttribute("stroke-width", "2.3");
  svg.appendChild(a);
  const b = document.createElementNS("http://www.w3.org/2000/svg", "path");
  b.setAttribute("fill", "none");
  b.setAttribute("stroke", "#ff5ea8");
  b.setAttribute("stroke-width", "2.3");
  b.setAttribute("opacity", "0.8");
  svg.appendChild(b);
  const dial = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dial.setAttribute("cx", "336");
  dial.setAttribute("cy", "42");
  dial.setAttribute("r", "18");
  dial.setAttribute("fill", "#f8fafd");
  dial.setAttribute("stroke", "#1d2a3f");
  dial.setAttribute("stroke-width", "2");
  svg.appendChild(dial);
  const hand = document.createElementNS("http://www.w3.org/2000/svg", "line");
  hand.setAttribute("stroke", "#1d2a3f");
  hand.setAttribute("stroke-width", "3");
  hand.setAttribute("stroke-linecap", "round");
  svg.appendChild(hand);
  let phase = Math.PI / 3;
  let dragging = false;
  const redraw = () => {
    const pa = [];
    const pb = [];
    for (let x = 30; x <= 305; x += 3) {
      const t = (x - 30) / 24;
      pa.push(`${x},${86 - Math.sin(t) * 34}`);
      pb.push(`${x},${86 - Math.sin(t + phase) * 34}`);
    }
    a.setAttribute("d", `M ${pa.join(" L ")}`);
    b.setAttribute("d", `M ${pb.join(" L ")}`);
    hand.setAttribute("x1", "336");
    hand.setAttribute("y1", "42");
    hand.setAttribute("x2", String(336 + Math.cos(phase) * 13));
    hand.setAttribute("y2", String(42 + Math.sin(phase) * 13));
    valueEl.textContent = `phase:${(phase * 57.3).toFixed(0)}° depth:${(Math.abs(Math.sin(phase)) * 100).toFixed(0)}%`;
  };
  dial.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    dragging = true;
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const r = svg.getBoundingClientRect();
    phase = Math.atan2(e.clientY - r.top - 42, e.clientX - r.left - 336);
    redraw();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });
  redraw();
}

function initGrain(host, valueEl) {
  const svg = createSvg(386, 170);
  host.appendChild(svg);
  const base = document.createElementNS("http://www.w3.org/2000/svg", "line");
  base.setAttribute("x1", "30");
  base.setAttribute("x2", "356");
  base.setAttribute("y1", "94");
  base.setAttribute("y2", "94");
  base.setAttribute("stroke", "#273346");
  base.setAttribute("stroke-width", "2");
  svg.appendChild(base);
  const blades = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svg.appendChild(blades);
  const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  handle.setAttribute("r", "7");
  handle.setAttribute("cy", "62");
  handle.setAttribute("fill", "#182739");
  svg.appendChild(handle);
  let spacing = 22;
  let dragging = false;
  const redraw = () => {
    blades.innerHTML = "";
    for (let x = 34; x <= 352; x += spacing) {
      const blade = document.createElementNS("http://www.w3.org/2000/svg", "line");
      blade.setAttribute("x1", String(x));
      blade.setAttribute("x2", String(x));
      blade.setAttribute("y1", "72");
      blade.setAttribute("y2", "118");
      blade.setAttribute("stroke", "#ff5d5d");
      blade.setAttribute("stroke-width", "2");
      blades.appendChild(blade);
    }
    handle.setAttribute("cx", String(40 + (spacing - 8) * 6));
    valueEl.textContent = `slice:${Math.round(spacing * 2)}ms density:${Math.round(100 - spacing * 2)}%`;
  };
  handle.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    dragging = true;
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const r = svg.getBoundingClientRect();
    spacing = clamp((e.clientX - r.left - 40) / 6 + 8, 10, 42);
    redraw();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });
  redraw();
}

function initWidget(type, host, valueEl) {
  if (type === "adsr") return initAdsr(host, valueEl);
  if (type === "lpf") return initFilter(host, valueEl, "lpf");
  if (type === "hpf") return initFilter(host, valueEl, "hpf");
  if (type === "frequency") return initPeak(host, valueEl);
  if (type === "centroid") return initCentroid(host, valueEl);
  if (type === "distortion") return initDistortion(host, valueEl);
  if (type === "compression") return initCompression(host, valueEl);
  if (type === "reverb") return initReverb(host, valueEl);
  if (type === "drywet") return initDryWet(host, valueEl);
  if (type === "phase") return initPhase(host, valueEl);
  if (type === "grain") return initGrain(host, valueEl);
}

function createNodePanel(type, x, y) {
  const def = NODE_DEFS[type];
  if (!def) return;
  const id = panelCounter;
  panelCounter += 1;
  const prefix = `panel-${id}`;

  const panel = document.createElement("article");
  panel.className = "node-panel";
  panel.dataset.panelId = String(id);
  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;

  const header = document.createElement("header");
  header.className = "panel-header";
  const title = document.createElement("span");
  title.className = "panel-title";
  title.textContent = def.title;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "panel-close";
  close.textContent = "×";
  header.append(title, close);

  const body = document.createElement("div");
  body.className = "panel-body";
  const widget = document.createElement("div");
  widget.className = "panel-widget";
  const value = document.createElement("div");
  value.className = "panel-value";
  body.append(widget, value);

  const meta = document.createElement("div");
  meta.className = "panel-meta";
  meta.innerHTML = `<div><b>AudioParam:</b> ${def.audioParam}</div><div><b>物理本质:</b> ${def.physics}</div>`;

  panel.append(header, body, meta);
  addPanelPorts(panel, def.colors, prefix);
  panelLayer.appendChild(panel);
  initWidget(type, widget, value);

  close.addEventListener("click", () => {
    removeEdgesForPrefix(prefix);
    panel.remove();
  });
}

function wireTemplateDrag() {
  sidebar.addEventListener("mousedown", (e) => {
    const card = e.target.closest(".node-template");
    if (!card || isSpacePressed) return;
    e.preventDefault();
    const type = card.dataset.nodeType;
    const def = NODE_DEFS[type];
    if (!def) return;
    const ghost = document.createElement("div");
    ghost.className = "floating-template";
    ghost.textContent = def.title;
    document.body.appendChild(ghost);
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    templateDrag = { type, ghost };
  });
}

function wireBubbleDrag() {
  const zone = document.querySelector(".center-zone");
  document.querySelectorAll(".system-bubble, #audioNode").forEach((bubble) => {
    bubble.addEventListener("mousedown", (e) => {
      if (isSpacePressed) return;
      if (e.target.closest(".port") || e.target.closest(".audio-picker-btn")) return;
      e.preventDefault();
      const zr = zone.getBoundingClientRect();
      const br = bubble.getBoundingClientRect();
      didBubbleDrag = false;
      bubbleDrag = {
        bubble,
        start: { x: e.clientX, y: e.clientY },
        origin: { left: br.left - zr.left, top: br.top - zr.top },
      };
      bubble.style.transform = "none";
      bubble.style.cursor = "grabbing";
    });
  });
}

function wirePanelDrag() {
  panelLayer.addEventListener("mousedown", (e) => {
    const header = e.target.closest(".panel-header");
    if (!header || isSpacePressed) return;
    e.preventDefault();
    const panel = header.closest(".node-panel");
    panelDrag = {
      panel,
      start: { x: e.clientX, y: e.clientY },
      origin: { left: panel.offsetLeft, top: panel.offsetTop },
    };
    header.style.cursor = "grabbing";
  });
}

function wirePortConnect() {
  workspace.addEventListener("mousedown", (e) => {
    const port = e.target.closest(".port");
    if (!port || isSpacePressed) return;
    e.preventDefault();
    startPortDrag(port);
  });
}

function wireGlobalPointer() {
  window.addEventListener("mousemove", (e) => {
    if (templateDrag) {
      templateDrag.ghost.style.left = `${e.clientX}px`;
      templateDrag.ghost.style.top = `${e.clientY}px`;
      return;
    }

    if (panelDrag) {
      const nx = panelDrag.origin.left + (e.clientX - panelDrag.start.x);
      const ny = panelDrag.origin.top + (e.clientY - panelDrag.start.y);
      panelDrag.panel.style.left = `${nx}px`;
      panelDrag.panel.style.top = `${ny}px`;
      renderEdges();
      return;
    }

    if (bubbleDrag) {
      const nx = bubbleDrag.origin.left + (e.clientX - bubbleDrag.start.x);
      const ny = bubbleDrag.origin.top + (e.clientY - bubbleDrag.start.y);
      if (Math.abs(e.clientX - bubbleDrag.start.x) > 2 || Math.abs(e.clientY - bubbleDrag.start.y) > 2) {
        didBubbleDrag = true;
      }
      bubbleDrag.bubble.style.left = `${nx}px`;
      bubbleDrag.bubble.style.top = `${ny}px`;
      renderEdges();
      return;
    }

    if (portDrag) {
      const rect = workspace.getBoundingClientRect();
      portDrag.cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      renderEdges();
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (templateDrag) {
      const inSidebar = !!e.target.closest(".sidebar");
      if (!inSidebar) {
        const p = worldPointFromClient(e.clientX, e.clientY);
        createNodePanel(templateDrag.type, p.x - PANEL_W / 2, p.y - PANEL_H / 2);
      }
      templateDrag.ghost.remove();
      templateDrag = null;
      return;
    }

    if (panelDrag) {
      const header = panelDrag.panel.querySelector(".panel-header");
      if (header) header.style.cursor = "grab";
      panelDrag = null;
      return;
    }

    if (bubbleDrag) {
      bubbleDrag.bubble.style.cursor = "grab";
      bubbleDrag = null;
      return;
    }

    if (portDrag) {
      finishPortDrag(e.target.closest(".port"));
    }
  });
}

function wireCanvasPan() {
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    e.preventDefault();
    isSpacePressed = true;
    workspace.classList.add("space-mode");
  });
  window.addEventListener("keyup", (e) => {
    if (e.code !== "Space") return;
    isSpacePressed = false;
    isPanning = false;
    workspace.classList.remove("space-mode", "panning");
  });
  workspace.addEventListener("mousedown", (e) => {
    if (!isSpacePressed || e.target.closest(".sidebar")) return;
    e.preventDefault();
    isPanning = true;
    workspace.classList.add("panning");
    panStart = { x: e.clientX, y: e.clientY };
    panAnchor = { ...worldOffset };
  });
  window.addEventListener("mousemove", (e) => {
    if (!isPanning) return;
    worldOffset = {
      x: panAnchor.x + (e.clientX - panStart.x),
      y: panAnchor.y + (e.clientY - panStart.y),
    };
    applyWorldTransform();
  });
  window.addEventListener("mouseup", () => {
    if (!isPanning) return;
    isPanning = false;
    workspace.classList.remove("panning");
    if (isSpacePressed) workspace.classList.add("space-mode");
  });
}

function wireAudio() {
  audioPickerBtn.addEventListener("click", (e) => {
    e.preventDefault();
    audioDialog.showModal();
  });

  audioHub.addEventListener("click", () => {
    if (didBubbleDrag) {
      didBubbleDrag = false;
      return;
    }
    if (!selectedAudio) return;
    if (player.paused) player.play();
    else player.pause();
  });

  confirmAudio.addEventListener("click", () => {
    selectedAudio = audioSelect.value;
    player.src = `./assets/${selectedAudio}`;
    player.pause();
    player.currentTime = 0;
    hubLabel.textContent = selectedAudio;
    playIcon.textContent = "▶";
  });

  player.addEventListener("play", () => {
    playIcon.textContent = "⏸";
  });
  player.addEventListener("pause", () => {
    playIcon.textContent = "▶";
  });
  player.addEventListener("ended", () => {
    playIcon.textContent = "▶";
  });
}

function setupWindowEvents() {
  window.addEventListener("resize", renderEdges);
}

buildAudioOptions();
wireMenus();
decorateTemplateMarkers();
wireTemplateDrag();
wireBubbleDrag();
wirePanelDrag();
wirePortConnect();
wireGlobalPointer();
wireAudio();
wireCanvasPan();
setupWindowEvents();
centerWorld();
