/*!
 * 拖拉机大赛 网页版 — 设置与牌局存档
 * Copyright (c) 2026 TractorCard Project. All rights reserved. 版权所有，保留一切权利。
 */
import { TractorGame, DEFAULT_OPTIONS } from './game.js';
import { makeTrump } from './rules.js';

const PREF_KEY = 'tractor.prefs.v1';
const SAVE_KEY = 'tractor.save.v1';

export const DEFAULT_PREFS = {
  face: 'classic',
  back: 'navy',
  sound: true,
  music: false,
  options: { ...DEFAULT_OPTIONS },
};

export function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
    if (!raw) return structuredClone(DEFAULT_PREFS);
    return { ...structuredClone(DEFAULT_PREFS), ...raw, options: { ...DEFAULT_OPTIONS, ...(raw.options || {}) } };
  } catch { return structuredClone(DEFAULT_PREFS); }
}

export function savePrefs(prefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {}
}

const FIELDS = [
  'levels', 'noTrumpPending', 'dealerSeat', 'handNo', 'phase', 'level', 'isNoTrumpHand',
  'hands', 'kitty', 'pending', 'dealSeat', 'declaration', 'trumpSuit',
  'tricks', 'currentTrick', 'defenderPoints', 'kittyMultiplier', 'seen', 'result',
];

export function serialize(game) {
  const out = { version: 1, options: game.options };
  for (const f of FIELDS) out[f] = game[f] === undefined ? null : game[f];
  return out;
}

export function saveGame(game) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(game))); return true; }
  catch { return false; }
}

export function hasSave() { return !!localStorage.getItem(SAVE_KEY); }

export function loadGame() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  const game = new TractorGame(data.options || {});
  for (const f of FIELDS) if (data[f] !== null && data[f] !== undefined) game[f] = data[f];
  if (game.trumpSuit !== undefined && game.phase !== 'dealing' && game.phase !== 'idle') {
    game.ctx = makeTrump(game.trumpSuit, game.level, game.options.constTwo);
  }
  if (game.phase === 'playing' && game.currentTrick) game.leadSeat = game.currentTrick.leadSeat;
  return game;
}
