"use strict";

/**
 * Simon Says game with screen-based state management.
 * Uses requestAnimationFrame for sequence timing and a small audio engine using Web Audio API.
 */

const LEVELS = [
  { id: 1, sequenceLength: 3, stepMs: 700 },
  { id: 2, sequenceLength: 4, stepMs: 620 },
  { id: 3, sequenceLength: 5, stepMs: 540 },
  { id: 4, sequenceLength: 6, stepMs: 470 },
  { id: 5, sequenceLength: 7, stepMs: 400 }
];

const COLORS = ["red", "blue", "green", "yellow"];
const COLOR_FREQUENCIES = {
  red: 329.63,
  blue: 392,
  green: 261.63,
  yellow: 523.25
};

const state = {
  screen: "menu",
  levelIndex: 0,
  score: 0,
  sequence: [],
  inputIndex: 0,
  acceptingInput: false,
  musicEnabled: true,
  isAnimatingSequence: false
};

const screens = {
  menu: document.getElementById("menu-screen"),
  levels: document.getElementById("level-screen"),
  game: document.getElementById("game-screen"),
  gameover: document.getElementById("gameover-screen"),
  victory: document.getElementById("victory-screen")
};

const levelButtonsWrap = document.getElementById("level-buttons");
const statusText = document.getElementById("status-text");
const scoreEl = document.getElementById("score");
const levelEl = document.getElementById("current-level");
const finalScoreEl = document.getElementById("final-score");
const victoryScoreEl = document.getElementById("victory-score");

const padMap = new Map();
for (const pad of document.querySelectorAll(".pad")) {
  padMap.set(pad.dataset.color, pad);
}

const musicButtons = [
  document.getElementById("menu-music-toggle"),
  document.getElementById("game-music-toggle")
];

let audioCtx;
let bgMasterGain;
let bgStartTime = 0;
let bgPhase = 0;
let bgRafId = null;

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    bgMasterGain = audioCtx.createGain();
    bgMasterGain.gain.value = 0;
    bgMasterGain.connect(audioCtx.destination);
  }

  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function playTone({ frequency, duration = 0.18, type = "sine", gainValue = 0.14 }) {
  ensureAudioContext();

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.value = frequency;

  gain.gain.setValueAtTime(0.001, now);
  gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function playColorSound(color) {
  playTone({ frequency: COLOR_FREQUENCIES[color], duration: 0.2, type: "triangle", gainValue: 0.13 });
}

function playWrongSound() {
  ensureAudioContext();
  const base = 220;
  playTone({ frequency: base, duration: 0.18, type: "sawtooth", gainValue: 0.12 });
  setTimeout(() => playTone({ frequency: base * 0.75, duration: 0.22, type: "sawtooth", gainValue: 0.13 }), 120);
}

function scheduleBackgroundMusic() {
  if (!audioCtx || !state.musicEnabled) {
    bgRafId = requestAnimationFrame(scheduleBackgroundMusic);
    return;
  }

  // Simple looping ambient progression, scheduled 0.5s ahead.
  const progression = [220, 246.94, 293.66, 329.63];
  const stepLen = 0.38;
  const horizon = audioCtx.currentTime + 0.5;

  while (bgStartTime < horizon) {
    const freq = progression[bgPhase % progression.length];
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    osc.frequency.value = freq;

    gain.gain.setValueAtTime(0.001, bgStartTime);
    gain.gain.linearRampToValueAtTime(0.038, bgStartTime + 0.06);
    gain.gain.linearRampToValueAtTime(0.001, bgStartTime + stepLen - 0.03);

    osc.connect(gain);
    gain.connect(bgMasterGain);

    osc.start(bgStartTime);
    osc.stop(bgStartTime + stepLen);

    bgStartTime += stepLen;
    bgPhase += 1;
  }

  bgRafId = requestAnimationFrame(scheduleBackgroundMusic);
}

function setMusicEnabled(enabled) {
  state.musicEnabled = enabled;
  if (bgMasterGain && audioCtx) {
    const now = audioCtx.currentTime;
    bgMasterGain.gain.cancelScheduledValues(now);
    bgMasterGain.gain.linearRampToValueAtTime(enabled ? 1 : 0, now + 0.12);
  }

  for (const button of musicButtons) {
    button.textContent = `Music: ${enabled ? "ON" : "OFF"}`;
    button.setAttribute("aria-pressed", String(enabled));
  }
}

function toggleMusic() {
  ensureAudioContext();
  setMusicEnabled(!state.musicEnabled);
}

function showScreen(name) {
  state.screen = name;
  for (const [key, screenEl] of Object.entries(screens)) {
    screenEl.classList.toggle("active", key === name);
  }
}

function updateHud() {
  levelEl.textContent = String(LEVELS[state.levelIndex].id);
  scoreEl.textContent = String(state.score);
}

function randColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function glowPad(color) {
  const pad = padMap.get(color);
  if (!pad) {
    return;
  }

  pad.classList.add("glow");
  setTimeout(() => pad.classList.remove("glow"), 240);
}

function createLevelButtons() {
  const fragment = document.createDocumentFragment();

  LEVELS.forEach((lvl, idx) => {
    const btn = document.createElement("button");
    btn.className = "level-btn";
    btn.type = "button";
    btn.innerHTML = `Level ${lvl.id}<small>Length ${lvl.sequenceLength}, speed ${lvl.stepMs}ms</small>`;
    btn.addEventListener("click", () => startRunFromLevel(idx));
    fragment.appendChild(btn);
  });

  levelButtonsWrap.appendChild(fragment);
}

function beginRound() {
  state.acceptingInput = false;
  state.isAnimatingSequence = true;
  state.inputIndex = 0;

  updateHud();
  statusText.textContent = "Watch the sequence...";
  playSequenceWithRaf(state.sequence, LEVELS[state.levelIndex].stepMs, () => {
    state.isAnimatingSequence = false;
    state.acceptingInput = true;
    statusText.textContent = "Your turn.";
  });
}

function startRunFromLevel(index) {
  ensureAudioContext();
  state.levelIndex = index;
  state.score = 0;
  state.sequence = [];

  const firstLength = LEVELS[state.levelIndex].sequenceLength;
  for (let i = 0; i < firstLength; i += 1) {
    state.sequence.push(randColor());
  }

  showScreen("game");
  beginRound();
}

function advanceLevelOrWin() {
  state.score += 100;

  if (state.levelIndex === LEVELS.length - 1) {
    victoryScoreEl.textContent = String(state.score);
    showScreen("victory");
    return;
  }

  state.levelIndex += 1;
  state.sequence.push(randColor());
  statusText.textContent = "Great! Next level...";

  setTimeout(beginRound, 650);
}

function onPadPress(color) {
  if (!state.acceptingInput || state.isAnimatingSequence || state.screen !== "game") {
    return;
  }

  glowPad(color);
  playColorSound(color);

  const expected = state.sequence[state.inputIndex];
  if (color !== expected) {
    state.acceptingInput = false;
    playWrongSound();
    finalScoreEl.textContent = String(state.score);
    showScreen("gameover");
    return;
  }

  state.inputIndex += 1;

  if (state.inputIndex >= state.sequence.length) {
    state.acceptingInput = false;
    advanceLevelOrWin();
  }
}

function playSequenceWithRaf(sequence, stepMs, onDone) {
  let idx = 0;
  let lastStamp = 0;
  const minInterval = Math.max(280, stepMs);

  function frame(ts) {
    if (!lastStamp) {
      lastStamp = ts;
      glowPad(sequence[idx]);
      playColorSound(sequence[idx]);
      idx += 1;
      requestAnimationFrame(frame);
      return;
    }

    if (ts - lastStamp >= minInterval) {
      if (idx >= sequence.length) {
        onDone();
        return;
      }
      glowPad(sequence[idx]);
      playColorSound(sequence[idx]);
      idx += 1;
      lastStamp = ts;
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function attachEvents() {
  document.getElementById("start-btn").addEventListener("click", () => showScreen("levels"));
  document.getElementById("back-menu-from-level").addEventListener("click", () => showScreen("menu"));

  document.getElementById("restart-btn").addEventListener("click", () => showScreen("levels"));
  document.getElementById("play-again-btn").addEventListener("click", () => showScreen("levels"));

  document.getElementById("back-menu-from-gameover").addEventListener("click", () => showScreen("menu"));
  document.getElementById("back-menu-from-victory").addEventListener("click", () => showScreen("menu"));

  document.getElementById("replay-sequence").addEventListener("click", () => {
    if (state.screen !== "game" || state.isAnimatingSequence || state.acceptingInput === false) {
      return;
    }

    state.acceptingInput = false;
    state.isAnimatingSequence = true;
    statusText.textContent = "Replaying...";

    playSequenceWithRaf(state.sequence, LEVELS[state.levelIndex].stepMs, () => {
      state.isAnimatingSequence = false;
      state.acceptingInput = true;
      state.inputIndex = 0;
      statusText.textContent = "Your turn.";
    });
  });

  for (const pad of padMap.values()) {
    pad.addEventListener("click", () => onPadPress(pad.dataset.color));
  }

  for (const button of musicButtons) {
    button.addEventListener("click", toggleMusic);
  }
}

function init() {
  createLevelButtons();
  attachEvents();
  showScreen("menu");

  ensureAudioContext();
  bgStartTime = audioCtx.currentTime + 0.03;
  scheduleBackgroundMusic();
  setMusicEnabled(true);
}

init();
