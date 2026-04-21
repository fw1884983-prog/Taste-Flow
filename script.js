const PANEL_W = 386;
const PANEL_H = 276;
/** ADSR 小窗加宽；与下方 SVG 宽度一致以便 R 段横向延伸 */
const PANEL_W_ADSR = 520;
const ADSR_SVG_W = 500;
const ADSR_S_X = 20;
const ADSR_U_X = 260;
/** R 端点最大 x；`(R_MAX−U)` 映射 5.0s */
const ADSR_R_MAX_X = ADSR_SVG_W - 20;
const ADSR_R_MAP_SPAN = Math.max(ADSR_R_MAX_X - ADSR_U_X, 1e-6);

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
    audioParam: "BiquadFilterNode.frequency + gain（A 顶更明显；R→各声部音量尾音秒）",
    physics:
      "S 起点与 S 段终点 U 在图上固定；其间仅拖 A、D 两点划分 A/D/S 比重（和为 1，A≤½），ADS 无独立秒数仅比例；R 端可沿横轴后拉，U→R 距离映射 0–5.0s；实际 ADS 总时长仍由上次整段弹奏缩放；松键按 R 回落；新一次按键生效。",
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
const pianoRig = document.getElementById("pianoRig");
const pianoKeys = document.getElementById("pianoKeys");
const pianoDragHandle = document.getElementById("pianoDragHandle");
const phonographRig = document.getElementById("phonographRig");
const phonographDragHandle = document.getElementById("phonographDragHandle");
const phonographRecordBtn = document.getElementById("phonographRecordBtn");
const phonographDisc = document.getElementById("phonographDisc");
const phonographSaveBtn = document.getElementById("phonographSaveBtn");
const phonographPlayback = document.getElementById("phonographPlayback");

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

/** 本地上传音频仅允许连续播放的最长时间（秒），从当前片段起点计。 */
const MAX_LOCAL_PLAYBACK_SEC = 10;

/** ADSR：相对中心频率的倍数（A 顶 1.2，S 段 1.0）；并联动 peaking 的 gain(dB) 便于听辨 ADS。 */
const ADSR_FREQ_BASE_HZ = 2600;
const ADSR_FREQ_PEAK = 1.2;
const ADSR_FREQ_SUSTAIN = 1;
const ADSR_FILTER_GAIN_BASE_DB = 4;
const ADSR_FILTER_GAIN_SWING_DB = 16;

let audioCtx = null;
let masterGainNode = null;
let adsrFilterNode = null;
/** 有琴键按下时使用的 ADSR 时间快照（秒），新一次发声开始时更新 */
let adsrPlaySnapshot = null;
let synthSessionStart = 0;
let adsrRafId = 0;
const pianoVoices = new Map();
const pianoKeyButtons = new Map();
const computerPianoCodes = new Set();
/** 与 ADSR 面板同步：x0/xu 为 ADS 视觉段起止，xR 为 R 段末端；R 像素跨度映射 0–5s */
let adsrTimeAxisPx = { x0: ADSR_S_X, xR: Math.min(ADSR_U_X + 120, ADSR_R_MAX_X), xa: 90, xd: 150, xu: ADSR_U_X };

/** 上次「整次弹奏」从首键按下到末键抬起的时长（秒），供下一次 ADS 总时长使用 */
let lastPianoHoldSec = 2.5;
/** 松键后滤波包络按 R 秒线性回落 */
let adsrReleasePhase = null;

function syncAdsrTimeAxisPxFromShape(p) {
  adsrTimeAxisPx = { x0: p.s.x, xR: p.r.x, xa: p.a.x, xd: p.d.x, xu: p.u.x };
}

function buildAdsrSnapshot() {
  const { x0, xR, xa, xd, xu } = adsrTimeAxisPx;
  const L_ads = Math.max(xu - x0, 1e-6);
  let rawA = (xa - x0) / L_ads;
  let rawD = (xd - xa) / L_ads;
  let rawS = (xu - xd) / L_ads;
  rawA = clamp(rawA, 0, 1);
  rawD = Math.max(0, rawD);
  rawS = Math.max(0, rawS);
  const rawSum = rawA + rawD + rawS;
  if (rawSum > 1e-6) {
    rawA /= rawSum;
    rawD /= rawSum;
    rawS /= rawSum;
  } else {
    rawA = 0.25;
    rawD = 0.35;
    rawS = 0.4;
  }
  let alphaA = Math.min(rawA, 0.5);
  const rem = 1 - alphaA;
  const dsf = rawD + rawS;
  let alphaD = dsf > 1e-6 ? (rem * rawD) / dsf : rem * 0.5;
  let alphaS = rem - alphaD;
  if (alphaS < 0) {
    alphaS = 0;
    alphaD = rem;
  }
  const T_ads = clamp(lastPianoHoldSec, 0.1, 30);
  const tA = alphaA * T_ads;
  const tD = tA + alphaD * T_ads;
  const tU = T_ads;
  const gapR = Math.max(xR - xu, 0);
  const tR = clamp((gapR / ADSR_R_MAP_SPAN) * 5, 0, 5);
  return { tA, tD, tU, tR, T_ads, alphaA, alphaD, alphaS };
}

function adsrFreqMultiplierAt(t, snap) {
  if (!snap) return ADSR_FREQ_SUSTAIN;
  const { tA, tD, tU } = snap;
  const tc = clamp(t, 0, tU);
  if (tc <= tA) {
    const w = tA > 1e-6 ? tc / tA : 1;
    return ADSR_FREQ_SUSTAIN + (ADSR_FREQ_PEAK - ADSR_FREQ_SUSTAIN) * w;
  }
  if (tc <= tD) {
    const w = tD > tA + 1e-6 ? (tc - tA) / (tD - tA) : 1;
    return ADSR_FREQ_PEAK + (ADSR_FREQ_SUSTAIN - ADSR_FREQ_PEAK) * w;
  }
  if (tc <= tU) return ADSR_FREQ_SUSTAIN;
  return ADSR_FREQ_SUSTAIN;
}

/** 当前快照下的 R（秒）：用于钢琴声部松键后的音量尾音；与面板 0–5s 一致 */
function getPianoReleaseSeconds() {
  const tr = adsrPlaySnapshot && typeof adsrPlaySnapshot.tR === "number" ? adsrPlaySnapshot.tR : null;
  if (tr == null || !Number.isFinite(tr)) return 0.12;
  return clamp(tr, 0.02, 5);
}

function applyAdsrPeakingFromMultiplier(m) {
  if (!audioCtx || !adsrFilterNode) return;
  const t = audioCtx.currentTime;
  adsrFilterNode.frequency.setTargetAtTime(ADSR_FREQ_BASE_HZ * m, t, 0.022);
  const gDb = ADSR_FILTER_GAIN_BASE_DB + (m - ADSR_FREQ_SUSTAIN) * ADSR_FILTER_GAIN_SWING_DB;
  adsrFilterNode.gain.setTargetAtTime(clamp(gDb, -2, 20), t, 0.03);
}

let mainAudioChainWired = false;
let recordStreamDestination = null;
let recordTapWired = false;
let phonographMediaRecorder = null;
let phonographChunks = [];
let phonographRecordingUrl = null;
let phonographLastBlob = null;
let phonographIsRecording = false;

function ensureAudioGraph() {
  if (audioCtx && masterGainNode && adsrFilterNode) return true;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    if (!audioCtx) audioCtx = new Ctx();
    if (!masterGainNode) {
      masterGainNode = audioCtx.createGain();
      masterGainNode.gain.value = 0.18;
    }
    if (!adsrFilterNode) {
      adsrFilterNode = audioCtx.createBiquadFilter();
      adsrFilterNode.type = "peaking";
      adsrFilterNode.frequency.value = ADSR_FREQ_BASE_HZ * ADSR_FREQ_SUSTAIN;
      adsrFilterNode.Q.value = 1.1;
      adsrFilterNode.gain.value = ADSR_FILTER_GAIN_BASE_DB;
    }
    if (!mainAudioChainWired) {
      masterGainNode.connect(adsrFilterNode);
      adsrFilterNode.connect(audioCtx.destination);
      mainAudioChainWired = true;
    }
    if (!recordStreamDestination) {
      recordStreamDestination = audioCtx.createMediaStreamDestination();
    }
    if (!recordTapWired && adsrFilterNode) {
      adsrFilterNode.connect(recordStreamDestination);
      recordTapWired = true;
    }
    return true;
  } catch (_e) {
    return false;
  }
}

function applyAdsrFilterFromSynthClock() {
  if (!audioCtx || !adsrFilterNode) return;

  if (pianoVoices.size > 0 && adsrPlaySnapshot) {
    const t = audioCtx.currentTime - synthSessionStart;
    const m = adsrFreqMultiplierAt(t, adsrPlaySnapshot);
    applyAdsrPeakingFromMultiplier(m);
    return;
  }

  if (adsrReleasePhase) {
    const elapsed = audioCtx.currentTime - adsrReleasePhase.start;
    const tr = clamp(adsrReleasePhase.snap.tR, 0, 5);
    if (elapsed >= tr) {
      applyAdsrPeakingFromMultiplier(ADSR_FREQ_SUSTAIN);
      adsrReleasePhase = null;
      return;
    }
    const w = tr > 1e-6 ? elapsed / tr : 1;
    const m = adsrReleasePhase.fromM + (ADSR_FREQ_SUSTAIN - adsrReleasePhase.fromM) * w;
    applyAdsrPeakingFromMultiplier(m);
  }
}

function stopAdsrRafLoop() {
  if (adsrRafId) cancelAnimationFrame(adsrRafId);
  adsrRafId = 0;
}

function adsrRafLoop() {
  applyAdsrFilterFromSynthClock();
  const keep = pianoVoices.size > 0 || adsrReleasePhase !== null;
  if (keep) {
    adsrRafId = requestAnimationFrame(adsrRafLoop);
  } else {
    adsrRafId = 0;
    if (audioCtx && adsrFilterNode) {
      applyAdsrPeakingFromMultiplier(ADSR_FREQ_SUSTAIN);
    }
  }
}

function startAdsrRafLoop() {
  if (adsrRafId) return;
  adsrRafId = requestAnimationFrame(adsrRafLoop);
}

function midiToHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** 两八度 C4–C6（60–84）：下排 Z 行 C4–B4，上排 Q 行 C5–C6 */
const KEYBOARD_TO_MIDI = {
  KeyZ: 60,
  KeyS: 61,
  KeyX: 62,
  KeyD: 63,
  KeyC: 64,
  KeyV: 65,
  KeyG: 66,
  KeyB: 67,
  KeyH: 68,
  KeyN: 69,
  KeyJ: 70,
  KeyM: 71,
  KeyQ: 72,
  Digit2: 73,
  KeyW: 74,
  Digit3: 75,
  KeyE: 76,
  KeyR: 77,
  Digit5: 78,
  KeyT: 79,
  Digit6: 80,
  KeyY: 81,
  Digit7: 82,
  KeyU: 83,
  KeyI: 84,
};

const PIANO_MIDI_MIN = 60;
const PIANO_MIDI_MAX = 84;
const PIANO_WHITE_W = 36;
const PIANO_KEY_GAP = 2;
const PIANO_BLACK_W = 22;
/** 键间滑音时长（秒），库乐队式连续滑音 */
const PIANO_PORTAMENTO_SEC = 0.09;

const PIANO_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiLabel(m) {
  return `${PIANO_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
}

function isBlackMidi(m) {
  return [1, 3, 6, 8, 10].includes(m % 12);
}

function buildPianoWhiteBlackLayout() {
  const whites = [];
  for (let m = PIANO_MIDI_MIN; m <= PIANO_MIDI_MAX; m += 1) {
    if (!isBlackMidi(m)) whites.push(m);
  }
  const blacks = [];
  for (let m = PIANO_MIDI_MIN; m <= PIANO_MIDI_MAX; m += 1) {
    if (!isBlackMidi(m)) continue;
    let after = -1;
    for (let i = 0; i < whites.length - 1; i += 1) {
      if (whites[i] < m && m < whites[i + 1]) {
        after = i;
        break;
      }
    }
    if (after >= 0) blacks.push({ midi: m, afterWhiteIndex: after });
  }
  return { whites, blacks };
}

const capturedPianoPointers = new Set();

function glideOscFrequencyTo(osc, hz, immediate) {
  if (!audioCtx || !osc) return;
  const t = audioCtx.currentTime;
  osc.frequency.cancelScheduledValues(t);
  const cur = osc.frequency.value;
  osc.frequency.setValueAtTime(cur, t);
  if (immediate) {
    osc.frequency.setValueAtTime(hz, t);
  } else {
    osc.frequency.linearRampToValueAtTime(hz, t + PIANO_PORTAMENTO_SEC);
  }
}

/** voiceId: `p:${pointerId}` 或 `k:${KeyboardEvent.code}` */
function pianoNoteOn(voiceId, midi, immediateAttack) {
  if (!ensureAudioGraph() || !audioCtx || !masterGainNode) return;
  void audioCtx.resume();

  const existing = pianoVoices.get(voiceId);
  if (existing) {
    if (existing.lastMidi === midi) return;
    glideOscFrequencyTo(existing.osc, midiToHz(midi), !!immediateAttack);
    pianoKeyButtons.get(existing.lastMidi)?.classList.remove("is-down");
    pianoKeyButtons.get(midi)?.classList.add("is-down");
    existing.lastMidi = midi;
    return;
  }

  const wasEmpty = pianoVoices.size === 0;
  const t0 = audioCtx.currentTime;
  if (wasEmpty) {
    adsrReleasePhase = null;
    adsrPlaySnapshot = buildAdsrSnapshot();
    synthSessionStart = t0;
    startAdsrRafLoop();
  }

  const osc = audioCtx.createOscillator();
  osc.type = "triangle";
  const hz = midiToHz(midi);
  osc.frequency.setValueAtTime(hz, t0);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.16, t0 + 0.02);
  osc.connect(g);
  g.connect(masterGainNode);
  osc.start(t0);
  pianoVoices.set(voiceId, { osc, gainNode: g, lastMidi: midi });
  pianoKeyButtons.get(midi)?.classList.add("is-down");
}

function pianoNoteOff(voiceId) {
  const v = pianoVoices.get(voiceId);
  if (!v || !audioCtx) return;
  const t = audioCtx.currentTime;
  const willBeEmpty = pianoVoices.size === 1;
  if (willBeEmpty) {
    lastPianoHoldSec = clamp(t - synthSessionStart, 0.08, 30);
    if (adsrPlaySnapshot) {
      const tPos = clamp(t - synthSessionStart, 0, adsrPlaySnapshot.T_ads);
      const fromM = adsrFreqMultiplierAt(tPos, adsrPlaySnapshot);
      adsrReleasePhase = { start: t, fromM, snap: adsrPlaySnapshot };
    }
  }
  const { osc, gainNode: g, lastMidi } = v;
  const releaseSec = getPianoReleaseSeconds();
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + releaseSec);
  try {
    osc.stop(t + releaseSec + 0.08);
  } catch (_e) {}
  pianoVoices.delete(voiceId);
  pianoKeyButtons.get(lastMidi)?.classList.remove("is-down");
  if (pianoVoices.size === 0) {
    startAdsrRafLoop();
  }
}

function buildPianoKeys() {
  if (!pianoKeys) return;
  pianoKeyButtons.clear();
  pianoKeys.innerHTML = "";
  const { whites, blacks } = buildPianoWhiteBlackLayout();
  const whitesWrap = document.createElement("div");
  whitesWrap.className = "piano-keys__whites";
  const totalW = whites.length * PIANO_WHITE_W + (whites.length - 1) * PIANO_KEY_GAP;
  pianoKeys.style.width = `${totalW}px`;

  whites.forEach((midi) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "piano-key piano-key--white";
    btn.dataset.midi = String(midi);
    btn.textContent = midiLabel(midi);
    whitesWrap.appendChild(btn);
    pianoKeyButtons.set(midi, btn);
  });
  pianoKeys.appendChild(whitesWrap);

  blacks.forEach(({ midi, afterWhiteIndex }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "piano-key piano-key--black";
    btn.dataset.midi = String(midi);
    btn.textContent = midiLabel(midi);
    const left = afterWhiteIndex * (PIANO_WHITE_W + PIANO_KEY_GAP) + PIANO_WHITE_W - PIANO_BLACK_W / 2;
    btn.style.left = `${left}px`;
    pianoKeys.appendChild(btn);
    pianoKeyButtons.set(midi, btn);
  });
}

function wirePianoPointerDelegation() {
  if (!pianoKeys) return;

  pianoKeys.addEventListener("pointerdown", (e) => {
    const key = e.target.closest(".piano-key");
    if (!key) return;
    e.preventDefault();
    const midi = Number(key.dataset.midi);
    if (!Number.isFinite(midi)) return;
    const voiceId = `p:${e.pointerId}`;
    try {
      pianoKeys.setPointerCapture(e.pointerId);
    } catch (_err) {}
    capturedPianoPointers.add(e.pointerId);
    pianoNoteOn(voiceId, midi, true);
  });

  pianoKeys.addEventListener("pointermove", (e) => {
    if (!capturedPianoPointers.has(e.pointerId)) return;
    const voiceId = `p:${e.pointerId}`;
    if (!pianoVoices.has(voiceId)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const key = el && el.closest && el.closest(".piano-key");
    if (!key || !pianoKeys.contains(key)) return;
    const midi = Number(key.dataset.midi);
    if (!Number.isFinite(midi)) return;
    pianoNoteOn(voiceId, midi, false);
  });

  const endPointer = (e) => {
    if (!capturedPianoPointers.has(e.pointerId)) return;
    capturedPianoPointers.delete(e.pointerId);
    const voiceId = `p:${e.pointerId}`;
    pianoNoteOff(voiceId);
    try {
      if (pianoKeys.hasPointerCapture(e.pointerId)) pianoKeys.releasePointerCapture(e.pointerId);
    } catch (_err) {}
  };
  pianoKeys.addEventListener("pointerup", endPointer);
  pianoKeys.addEventListener("pointercancel", endPointer);
}

function wirePiano() {
  buildPianoKeys();
  wirePianoPointerDelegation();

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.target.closest("input, textarea, select")) return;
    if (e.target.closest(".sidebar")) return;
    const midi = KEYBOARD_TO_MIDI[e.code];
    if (midi == null) return;
    e.preventDefault();
    if (computerPianoCodes.has(e.code)) return;
    computerPianoCodes.add(e.code);
    const voiceId = `k:${e.code}`;
    pianoNoteOn(voiceId, midi, true);
  });

  window.addEventListener("keyup", (e) => {
    const midi = KEYBOARD_TO_MIDI[e.code];
    if (midi == null) return;
    if (e.target.closest(".sidebar")) return;
    computerPianoCodes.delete(e.code);
    const voiceId = `k:${e.code}`;
    pianoNoteOff(voiceId);
  });

  window.addEventListener("blur", () => {
    [...computerPianoCodes].forEach((code) => {
      const voiceId = `k:${code}`;
      pianoNoteOff(voiceId);
      computerPianoCodes.delete(code);
    });
    capturedPianoPointers.forEach((pid) => {
      pianoNoteOff(`p:${pid}`);
    });
    capturedPianoPointers.clear();
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

  appendPhonographVirtualEdge();
}

function appendPhonographVirtualEdge() {
  const a0 = document.getElementById("pianoAttachAnchor");
  const a1 = document.getElementById("phonographAttachAnchor");
  if (!a0 || !a1) return;
  const from = getPoint(a0);
  const to = getPoint(a1);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(from.x));
  line.setAttribute("y1", String(from.y));
  line.setAttribute("x2", String(to.x));
  line.setAttribute("y2", String(to.y));
  line.setAttribute("stroke", "#9588a5");
  line.setAttribute("stroke-width", "2");
  line.setAttribute("stroke-dasharray", "8 6");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("opacity", "0.88");
  edgeLayer.appendChild(line);
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

/** 将屏幕 x 转为 SVG 用户坐标（避免 viewBox 缩放后拖动手感错位） */
function clientToSvgUserX(svgEl, clientX) {
  if (svgEl.createSVGPoint && svgEl.getScreenCTM) {
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = 0;
    const ctm = svgEl.getScreenCTM();
    if (ctm) return pt.matrixTransform(ctm.inverse()).x;
  }
  const r = svgEl.getBoundingClientRect();
  const vb = svgEl.viewBox?.baseVal;
  const vw = vb?.width || r.width;
  return ((clientX - r.left) / Math.max(r.width, 1e-6)) * vw;
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
  valueEl.textContent = "";
  valueEl.style.pointerEvents = "none";
  valueEl.style.visibility = "hidden";

  const svg = createSvg(ADSR_SVG_W, 170);
  host.appendChild(svg);
  const Y_BASE = 150;
  const Y_PEAK = 24;
  const Y_SUST = 76;
  const p = {
    s: { x: ADSR_S_X, y: Y_BASE },
    a: { x: 90, y: Y_PEAK },
    d: { x: 150, y: Y_SUST },
    u: { x: ADSR_U_X, y: Y_SUST },
    r: { x: Math.min(ADSR_U_X + 120, ADSR_R_MAX_X), y: Y_BASE },
  };
  const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
  axis.setAttribute("x1", String(p.s.x));
  axis.setAttribute("y1", String(Y_BASE + 6));
  axis.setAttribute("x2", String(p.r.x));
  axis.setAttribute("y2", String(Y_BASE + 6));
  axis.setAttribute("stroke", "#9aa4b5");
  axis.setAttribute("stroke-width", "1");
  axis.setAttribute("stroke-dasharray", "4 4");
  svg.appendChild(axis);

  const poly = document.createElementNS("http://www.w3.org/2000/svg", "path");
  poly.setAttribute("fill", "rgba(77,143,255,0.22)");
  poly.setAttribute("stroke", "#2d73d4");
  poly.setAttribute("stroke-width", "2.4");
  svg.appendChild(poly);
  const keys = ["a", "d", "r"];
  const handles = keys.map((k) => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.dataset.k = k;
    c.setAttribute("r", k === "r" ? "9" : "7");
    c.setAttribute("fill", k === "r" ? "#1a4a7a" : "#0f1b2a");
    svg.appendChild(c);
    return c;
  });
  let active = "";

  const redraw = () => {
    p.s.x = ADSR_S_X;
    p.u.x = ADSR_U_X;
    p.a.y = Y_PEAK;
    p.d.y = Y_SUST;
    p.u.y = Y_SUST;
    p.s.y = Y_BASE;
    p.r.y = Y_BASE;
    const gap = 14;
    const maxAxHalf = p.s.x + (p.u.x - p.s.x) * 0.5 - gap * 0.25;
    for (let i = 0; i < 4; i += 1) {
      p.a.x = clamp(p.a.x, p.s.x + gap, Math.min(p.d.x - gap, maxAxHalf));
      p.d.x = clamp(p.d.x, p.a.x + gap, p.u.x - gap);
      p.r.x = clamp(p.r.x, p.u.x + gap, ADSR_R_MAX_X);
    }
    axis.setAttribute("x2", String(p.r.x));
    poly.setAttribute(
      "d",
      `M ${p.s.x} ${p.s.y} L ${p.a.x} ${p.a.y} L ${p.d.x} ${p.d.y} L ${p.u.x} ${p.u.y} L ${p.r.x} ${p.r.y} L ${p.r.x} ${p.s.y} L ${p.s.x} ${p.s.y} Z`,
    );
    handles.forEach((h) => {
      const key = h.dataset.k;
      h.setAttribute("cx", String(p[key].x));
      h.setAttribute("cy", String(p[key].y));
    });
    syncAdsrTimeAxisPxFromShape(p);
    buildAdsrSnapshot();
  };
  svg.addEventListener("mousedown", (e) => {
    const h = e.target.closest("circle");
    if (!h) return;
    e.preventDefault();
    e.stopPropagation();
    active = h.dataset.k;
  });
  const onMove = (e) => {
    if (!active) return;
    const x = clientToSvgUserX(svg, e.clientX);
    const gap = 14;
    const spanAds = Math.max(p.u.x - p.s.x, gap * 3);
    const maxAxHalf = p.s.x + spanAds * 0.5 - gap * 0.25;
    if (active === "a") {
      p.a.x = clamp(x, p.s.x + gap, Math.min(p.d.x - gap, maxAxHalf));
    } else if (active === "d") {
      p.d.x = clamp(x, p.a.x + gap, p.u.x - gap);
    } else if (active === "r") {
      p.r.x = clamp(x, p.u.x + gap, ADSR_R_MAX_X);
    }
    redraw();
  };
  const onUp = () => {
    active = "";
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
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

  const panelW = type === "adsr" ? PANEL_W_ADSR : PANEL_W;

  const panel = document.createElement("article");
  panel.className = "node-panel";
  if (type === "adsr") panel.classList.add("node-panel--adsr");
  panel.dataset.panelId = String(id);
  panel.dataset.nodeType = type;
  panel.style.left = `${x}px`;
  panel.style.top = `${y}px`;
  panel.style.width = `${panelW}px`;

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
  if (type === "adsr") {
    meta.style.display = "none";
  } else {
    meta.innerHTML = `<div><b>AudioParam:</b> ${def.audioParam}</div><div><b>物理本质:</b> ${def.physics}</div>`;
  }

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
  document.querySelectorAll(".system-bubble").forEach((bubble) => {
    bubble.addEventListener("mousedown", (e) => {
      if (isSpacePressed) return;
      if (e.target.closest(".port")) return;
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

  if (pianoRig && pianoDragHandle && zone) {
    pianoDragHandle.addEventListener("mousedown", (e) => {
      if (isSpacePressed) return;
      e.preventDefault();
      const zr = zone.getBoundingClientRect();
      const br = pianoRig.getBoundingClientRect();
      didBubbleDrag = false;
      bubbleDrag = {
        bubble: pianoRig,
        start: { x: e.clientX, y: e.clientY },
        origin: { left: br.left - zr.left, top: br.top - zr.top },
      };
      pianoRig.style.transform = "none";
      pianoDragHandle.style.cursor = "grabbing";
    });
  }

  if (phonographRig && phonographDragHandle && zone) {
    phonographDragHandle.addEventListener("mousedown", (e) => {
      if (isSpacePressed) return;
      e.preventDefault();
      const zr = zone.getBoundingClientRect();
      const br = phonographRig.getBoundingClientRect();
      didBubbleDrag = false;
      bubbleDrag = {
        bubble: phonographRig,
        start: { x: e.clientX, y: e.clientY },
        origin: { left: br.left - zr.left, top: br.top - zr.top },
      };
      phonographRig.style.transform = "none";
      phonographDragHandle.style.cursor = "grabbing";
    });
  }
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
        const spawnW = templateDrag.type === "adsr" ? PANEL_W_ADSR : PANEL_W;
        createNodePanel(templateDrag.type, p.x - spawnW / 2, p.y - PANEL_H / 2);
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
      const phHdr = bubbleDrag.bubble.querySelector(".phonograph-rig__header");
      const piHdr = bubbleDrag.bubble.querySelector(".piano-rig__header");
      if (phHdr) phHdr.style.cursor = "grab";
      else if (piHdr) piHdr.style.cursor = "grab";
      else bubbleDrag.bubble.style.cursor = "grab";
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

function setupWindowEvents() {
  window.addEventListener("resize", renderEdges);
}

function pickPhonographRecorderMime() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function stopPhonographRecording() {
  if (phonographMediaRecorder && phonographMediaRecorder.state === "recording") {
    phonographMediaRecorder.stop();
  }
}

function finalizePhonographRecording() {
  phonographIsRecording = false;
  if (phonographRecordBtn) {
    phonographRecordBtn.classList.remove("is-recording");
    phonographRecordBtn.setAttribute("aria-pressed", "false");
  }
  const blob = new Blob(phonographChunks, { type: phonographChunks[0]?.type || "audio/webm" });
  phonographChunks = [];
  if (blob.size < 1) return;
  phonographLastBlob = blob;
  if (phonographRecordingUrl) {
    URL.revokeObjectURL(phonographRecordingUrl);
    phonographRecordingUrl = null;
  }
  phonographRecordingUrl = URL.createObjectURL(blob);
  if (phonographPlayback) {
    phonographPlayback.src = phonographRecordingUrl;
  }
  if (phonographSaveBtn) phonographSaveBtn.disabled = false;
}

function startPhonographRecording() {
  if (!recordStreamDestination) return;
  const stream = recordStreamDestination.stream;
  if (!stream?.getAudioTracks?.().length) return;
  if (typeof MediaRecorder === "undefined") return;
  phonographPlayback?.pause();
  const mime = pickPhonographRecorderMime();
  try {
    phonographChunks = [];
    phonographMediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch (_e) {
    phonographMediaRecorder = new MediaRecorder(stream);
  }
  phonographMediaRecorder.ondataavailable = (ev) => {
    if (ev.data?.size) phonographChunks.push(ev.data);
  };
  phonographMediaRecorder.onstop = () => {
    finalizePhonographRecording();
  };
  phonographMediaRecorder.start(250);
  phonographIsRecording = true;
  if (phonographRecordBtn) {
    phonographRecordBtn.classList.add("is-recording");
    phonographRecordBtn.setAttribute("aria-pressed", "true");
  }
}

function wirePhonograph() {
  if (!phonographRecordBtn || !phonographDisc || !phonographPlayback) return;

  phonographRecordBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (phonographIsRecording) {
      stopPhonographRecording();
      return;
    }
    if (!ensureAudioGraph()) return;
    if (audioCtx?.state === "suspended") void audioCtx.resume();
    startPhonographRecording();
  });

  const playFromStart = () => {
    if (!phonographLastBlob && !phonographPlayback.src) return;
    phonographPlayback.currentTime = 0;
    const p = phonographPlayback.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  };

  phonographDisc.addEventListener("pointerenter", () => {
    if (phonographIsRecording) return;
    if (!phonographLastBlob && !phonographPlayback.src) return;
    playFromStart();
  });
  phonographDisc.addEventListener("pointerleave", () => {
    phonographPlayback.pause();
  });

  if (phonographSaveBtn) {
    phonographSaveBtn.addEventListener("click", () => {
      if (!phonographLastBlob) return;
      const ext = phonographLastBlob.type.includes("ogg") ? "ogg" : "webm";
      const url = URL.createObjectURL(phonographLastBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `taste-flow-phonograph-${Date.now()}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
  }
}

wireMenus();
decorateTemplateMarkers();
wireTemplateDrag();
wireBubbleDrag();
wirePanelDrag();
wirePortConnect();
wireGlobalPointer();
wirePiano();
wirePhonograph();
wireCanvasPan();
setupWindowEvents();
centerWorld();
