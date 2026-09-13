/*!
 * 拖拉机大赛 网页版 — 主控制器
 * Copyright (c) 2026 TractorCard Project. All rights reserved. 版权所有，保留一切权利。
 * 未经著作权人事先书面授权，不得使用、复制、修改、分发本作品或其任何部分。
 */
import { TractorGame, TEAM, DEFAULT_OPTIONS } from './game.js';
import { aiDeclare, aiBury, aiPlay } from './ai.js';
import { makeTrump, sortHand } from './rules.js';
import { validateLead, buildFollow } from './play.js';
import { SUIT_CN, SUIT_SYM, pointsOf, cardLabel } from './cards.js';
import { TableView, modal, confirmBox, el, $, SEAT_NAME, SEAT_SHORT, BACKS, FACES, cardNode } from './ui.js';
import { loadPrefs, savePrefs, saveGame, loadGame, hasSave } from './persist.js';
import { sfx } from './sound.js';
import { LocalTransport } from './net/transport.js';
import { RULES_HTML, ABOUT_HTML } from './help.js';

const HUMAN = 0;
const SPEED_DEAL = [170, 90, 36];
const SPEED_THINK = [900, 520, 240];
const SPEED_TRICK = [1500, 950, 520];

const prefs = loadPrefs();
let game = new TractorGame(prefs.options);
const view = new TableView($('#table'), prefs);
const transport = new LocalTransport(() => {}, HUMAN);   // 单机：动作本地结算，联机时替换

sfx.setSound(prefs.sound);
sfx.setMusic(false);          // 音乐需用户交互后才能播放
let humanResolve = null;      // 等待玩家出牌
let declineDeclare = null;    // 玩家点了“不亮”时记住当时的选项
let running = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dealMs = () => SPEED_DEAL[prefs.options.speed] ?? 90;
const thinkMs = () => SPEED_THINK[prefs.options.speed] ?? 520;
const trickMs = () => SPEED_TRICK[prefs.options.speed] ?? 950;

// ------------------------------------------------------------------ 渲染

function render({ trick = game.currentTrick, selectable = true } = {}) {
  const ctx = game.ctx || makeTrump(null, game.level || '2', prefs.options.constTwo);
  view.renderSeats(game, { humanSeat: HUMAN, turnSeat: game.turnSeat });
  view.renderTrick(trick, ctx);
  view.renderStatus(game);
  view.renderScore(game, HUMAN);
  const hand = game.hands ? sortHand(game.hands[HUMAN], ctx) : [];
  view.renderHand(hand, ctx, {
    selectable,
    onToggle: toggleCard,
    onDouble: (card) => { view.selected.clear(); view.selected.add(card.id); view.refreshSelection(); submit(); },
    onRange: selectRange,
  });
  updatePlayButton();
}

function toggleCard(card) {
  if (view.selected.has(card.id)) view.selected.delete(card.id);
  else view.selected.add(card.id);
  sfx.select();
  view.refreshSelection();
  updatePlayButton();
}

/** 右键：拾取或放回同花色（或主牌）中以左的所有牌，与原版一致。 */
function selectRange(card, index) {
  const ctx = game.ctx;
  const hand = sortHand(game.hands[HUMAN], ctx);
  const g = ctx.groupOf(card);
  let start = index;
  while (start > 0 && ctx.groupOf(hand[start - 1]) === g) start--;
  const ids = hand.slice(start, index + 1).map((c) => c.id);
  const allOn = ids.every((id) => view.selected.has(id));
  for (const id of ids) allOn ? view.selected.delete(id) : view.selected.add(id);
  sfx.select();
  view.refreshSelection();
  updatePlayButton();
}

function updatePlayButton() {
  const n = view.selected.size;
  const btn = view.playBtn;
  if (game.phase === 'bury' && game.dealerSeat === HUMAN) {
    btn.disabled = n !== 8;
    $('span', btn).textContent = `扣底 ${n}/8`;
    return;
  }
  $('span', btn).textContent = '出牌';
  btn.disabled = !(game.phase === 'playing' && game.turnSeat === HUMAN && n > 0);
}

function selectedCards() {
  const ids = new Set(view.selectedIds);
  return game.hands[HUMAN].filter((c) => ids.has(c.id));
}

// ------------------------------------------------------------------ 玩家动作

function submit() {
  if (game.phase === 'bury' && game.dealerSeat === HUMAN) return submitBury();
  if (game.phase !== 'playing' || game.turnSeat !== HUMAN) return;
  const cards = selectedCards();
  if (!cards.length) { view.setHint('请先选择要出的牌', true); return; }

  const lead = game.leadDescriptor;
  if (!lead) {
    const others = [1, 2, 3].map((s) => game.hands[s]);
    const v = validateLead(cards, others, game.ctx);
    if (!v.ok) {
      sfx.invalid();
      if (v.forced) {
        view.setHint(`${v.reason}：${v.forced.map(cardLabel).join(' ')}`, true);
        view.selected = new Set(v.forced.map((c) => c.id));
        view.refreshSelection();
        commitHuman(v.forced);
        return;
      }
      view.setHint(v.reason, true);
      return;
    }
    if (v.thrown) view.flashBanner('甩牌！');
    commitHuman(cards);
    return;
  }
  const res = game.validate(HUMAN, cards);
  if (!res.ok) { sfx.invalid(); view.setHint(res.reason, true); return; }
  commitHuman(cards);
}

function commitHuman(cards) {
  transport.send({ type: 'play', seat: HUMAN, cards: cards.map((c) => c.id) });
  const r = game.play(HUMAN, cards);
  if (!r.ok) { sfx.invalid(); view.setHint(r.reason, true); return; }
  sfx.play();
  view.clearSelection();
  view.setHint('');
  if (humanResolve) { const f = humanResolve; humanResolve = null; f(); }
}

function submitBury() {
  const cards = selectedCards();
  const r = game.bury(HUMAN, cards);
  if (!r.ok) { sfx.invalid(); view.setHint(r.reason, true); return; }
  sfx.play();
  view.clearSelection();
  view.setHint('');
  if (humanResolve) { const f = humanResolve; humanResolve = null; f(); }
}

view.playBtn.addEventListener('click', submit);
document.addEventListener('keydown', (e) => {
  if (e.key === 'F2') { e.preventDefault(); askNewGame(); }
  if (e.key === 'F1') { e.preventDefault(); showHelp(); }
  if (e.key === 'Enter' && !$('#modalRoot').hidden === false) submit();
});
$('#hand').addEventListener('contextmenu', (e) => e.preventDefault());

// ------------------------------------------------------------------ 亮牌

function refreshDeclareBar() {
  if (game.phase !== 'dealing') { view.hideDeclare(); return; }
  const opts = game.declareOptions(HUMAN);
  const sig = opts.map((o) => o.type + o.suit).join(',');
  if (!opts.length || declineDeclare === sig) { view.hideDeclare(); return; }
  view.showDeclare(opts, {
    current: game.declaration,
    onPick: (o) => {
      game.declare(HUMAN, o);
      sfx.declare();
      view.flashBanner(`你${o.label}：${o.suit === null ? '无主' : SUIT_CN[o.suit]}`);
      declineDeclare = null;
      refreshDeclareBar();
      render();
    },
    onPass: () => { declineDeclare = sig; view.hideDeclare(); },
  });
}

// ------------------------------------------------------------------ 主循环

async function doDealing() {
  declineDeclare = null;
  view.clearSelection();
  view.setHint('发牌中…');
  render();
  view.renderKitty(game.kitty, { hidden: true });
  while (!game.dealingDone) {
    game.dealStep();
    sfx.deal();
    for (let s = 0; s < 4; s++) {
      if (s === HUMAN) continue;
      const o = aiDeclare(game, s);
      if (o) {
        game.declare(s, o);
        sfx.declare();
        view.flashBanner(`${SEAT_SHORT[s]}家${o.label}：${o.suit === null ? '无主' : SUIT_CN[o.suit] + SUIT_SYM[o.suit]}`, 900);
      }
    }
    refreshDeclareBar();
    render();
    await sleep(dealMs());
  }
  view.hideDeclare();

  const info = game.closeDeal();
  view.renderKitty(null);
  if (!game.declaration) {
    view.flashBanner(info.revealed
      ? `无人亮牌，翻底定主：${SUIT_CN[info.trumpSuit]}${SUIT_SYM[info.trumpSuit]}`
      : '本局无主', 1600);
  }
  view.setHint(game.dealerSeat === HUMAN
    ? '你是庄家，请从手中选出八张底牌，然后按“扣底”。'
    : `${SEAT_SHORT[game.dealerSeat]}家坐庄，正在扣底…`);
  render();
  await sleep(trickMs());
}

async function doBury() {
  if (game.dealerSeat === HUMAN) {
    view.setHint('你是庄家，请从手中选出八张底牌，然后按“扣底”。');
    render();
    await new Promise((r) => { humanResolve = r; });
  } else {
    view.setHint(`${SEAT_SHORT[game.dealerSeat]}家坐庄，正在扣底…`);
    render();
    await sleep(thinkMs());
    if (game.phase === 'bury') game.bury(game.dealerSeat, aiBury(game, game.dealerSeat));
  }
  view.setHint('');
  render();
}

async function doPlaying() {
  while (game.phase === 'playing') {
    const seat = game.turnSeat;
    const before = game.tricks.length;
    if (seat === HUMAN) {
      view.setHint(game.leadDescriptor ? '请跟牌' : '请首攻出牌');
      render();
      await new Promise((r) => { humanResolve = r; });
    } else {
      render();
      await sleep(thinkMs());
      if (game.phase !== 'playing' || game.turnSeat !== seat) continue;
      const cards = aiPlay(game, seat);
      let r = game.play(seat, cards);
      if (!r.ok && r.forced) r = game.play(seat, r.forced);
      if (!r.ok) {                       // 兜底：绝不应发生
        const lead = game.leadDescriptor;
        game.play(seat, lead ? buildFollow(game.hands[seat], lead, game.ctx, 'low') : [game.hands[seat][0]]);
      }
      sfx.play();
    }
    if (game.tricks.length > before) {
      const t = game.tricks[game.tricks.length - 1];
      render({ trick: t, selectable: false });
      const mine = TEAM(t.winner) === TEAM(HUMAN);
      view.flashBanner(`${SEAT_SHORT[t.winner]}家得这一墩${t.points ? ` · ${t.points} 分` : ''}`, Math.max(400, trickMs() - 120));
      if (t.points > 0) mine ? sfx.win() : sfx.lose();
      await sleep(trickMs());
    }
    render();
  }
}

/** 从当前阶段把这一副牌打完。 */
async function runFromPhase() {
  if (game.phase === 'dealing') await doDealing();
  if (game.phase === 'bury') await doBury();
  if (game.phase === 'playing') await doPlaying();
  if (game.phase === 'hand-over') await showResult(game.result);
}

/**
 * 主循环。resume 为真时从存档所处的阶段接着打，否则从新的一副开始。
 * 换新游戏 / 读取存档会把 generation 加一，让旧循环自行退出。
 */
let generation = 0;
async function mainLoop({ resume = false } = {}) {
  if (running) return;
  running = true;
  const myGen = ++generation;
  try {
    if (resume) {
      await runFromPhase();
      if (myGen !== generation) return;
      if (game.result && game.result.matchOver) return;
      if (game.result) game.advanceHand();
    }
    while (myGen === generation) {
      game.newHand();
      await runFromPhase();
      if (myGen !== generation) return;
      if (game.result.matchOver) break;
      game.advanceHand();
    }
  } finally { if (myGen === generation) running = false; }
}

// ------------------------------------------------------------------ 结算对话框

function showResult(r) {
  const mine = TEAM(HUMAN);
  const won = r.winnerTeam === mine;
  sfx.upgrade(won);
  const teamName = (t) => (t === mine ? '我方（南北）' : '对方（东西）');
  const rows = [
    ['本局级牌', r.level === 'A' && r.wasNoTrump ? '无主' : r.level],
    ['主牌花色', r.trumpSuit === null ? '无主' : SUIT_CN[r.trumpSuit] + SUIT_SYM[r.trumpSuit]],
    ['庄家', `${SEAT_NAME[r.dealerSeat]}（${teamName(r.dealTeam)}）`],
    ['闲家台面分', `${r.defenderPoints - r.kittyBonus} 分`],
    ['底牌分', `${r.kittyPoints} 分`],
  ];
  if (r.kittyBonus) rows.push(['抠底', `${r.kittyPoints} × ${r.kittyMultiplier} = ${r.kittyBonus} 分`]);
  rows.push(['闲家合计', `${r.defenderPoints} 分`]);
  rows.push(['结果', r.desc]);
  rows.push([`${teamName(r.winnerTeam)}级别`, `${r.levelBefore} → ${r.levelAfter}`]);
  if (r.noTrumpPending[r.winnerTeam]) rows.push(['下一副', '打无主']);

  const html = `
    <div class="big-result">${won ? '本局我方得利' : '本局对方得利'}　${r.desc}</div>
    <table class="result-table">${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
    ${r.matchOver ? `<p style="margin-top:14px;text-align:center;font-size:1.05rem;color:#ffd98a">
      ${r.winnerTeam === mine ? '恭喜，你方打过无主，赢得全局！' : '很遗憾，对方打过无主，本局结束。'}</p>` : ''}`;
  const body = el('div');
  body.innerHTML = html;
  if (game.kitty && game.kitty.length) {
    const wrap = el('div');
    wrap.style.marginTop = '14px';
    wrap.appendChild(el('div', null, `底牌（${r.kittyPoints} 分）`)).style.cssText = 'font-size:.82rem;color:#9fb2b2;margin-bottom:6px';
    const row = el('div');
    row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap';
    for (const c of sortHand(game.kitty, game.ctx)) row.appendChild(cardNode(c, { faceStyle: prefs.face, extra: 'mini' }));
    wrap.appendChild(row);
    body.appendChild(wrap);
  }
  return new Promise((resolve) => {
    modal({
      title: r.matchOver ? '全局结束' : `第 ${r.handNo} 副结算`,
      bodyNode: body,
      buttons: [{ label: r.matchOver ? '再来一局' : '下一副', primary: true }],
      onClose: () => {
        resolve();
        if (r.matchOver) restartGame();
      },
    });
  });
}

// ------------------------------------------------------------------ 菜单

for (const menu of document.querySelectorAll('.menu')) {
  const title = $('.menu-title', menu);
  title.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.classList.contains('open');
    document.querySelectorAll('.menu').forEach((m) => m.classList.remove('open'));
    menu.classList.toggle('open', !open);
  });
}
document.addEventListener('click', () => document.querySelectorAll('.menu').forEach((m) => m.classList.remove('open')));

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const a = btn.dataset.action;
  document.querySelectorAll('.menu').forEach((m) => m.classList.remove('open'));
  ({
    'new-game': askNewGame,
    save: () => {
      const ok = saveGame(game);
      modal({ title: '储存牌局', bodyHTML: `<p>${ok ? '当前牌局已存入本机浏览器。' : '储存失败，浏览器可能禁用了本地存储。'}</p>` });
    },
    load: () => {
      if (!hasSave()) return modal({ title: '读取牌局', bodyHTML: '<p>本机没有找到已储存的牌局。</p>' });
      confirmBox('读取牌局', '读取存档将中止当前这一副牌，确定吗？', () => {
        const g = loadGame();
        if (!g) return modal({ title: '读取牌局', bodyHTML: '<p>存档已损坏，无法读取。</p>' });
        generation++;
        if (humanResolve) { const f = humanResolve; humanResolve = null; f(); }
        running = false;
        game = g;
        Object.assign(prefs.options, g.options);
        view.clearSelection();
        render();
        setTimeout(() => mainLoop({ resume: true }), 60);
      });
    },
    quit: () => modal({
      title: '退出', bodyHTML: '<p>网页版无法自行关闭窗口，直接关闭本标签页即可。<br>别忘了先“储存牌局”。</p>',
    }),
    'opt-rules': optRules,
    'opt-difficulty': () => optChoice('游戏难度', 'difficulty', ['低级', '中级', '高级']),
    'opt-speed': () => optChoice('游戏速度', 'speed', ['慢', '中', '快']),
    'opt-face': optFace,
    'opt-back': optBack,
    'toggle-music': () => { prefs.music = !prefs.music; sfx.setMusic(prefs.music); savePrefs(prefs); syncTicks(); },
    'toggle-sound': () => { prefs.sound = !prefs.sound; sfx.setSound(prefs.sound); savePrefs(prefs); syncTicks(); },
    help: showHelp,
    about: () => modal({ title: '版本信息', bodyHTML: ABOUT_HTML }),
  })[a]?.();
});

function syncTicks() {
  $('#tickMusic').textContent = prefs.music ? '√' : '';
  $('#tickSound').textContent = prefs.sound ? '√' : '';
}

function restartGame() {
  generation++;
  if (humanResolve) { const f = humanResolve; humanResolve = null; f(); }
  running = false;
  game = new TractorGame(prefs.options);
  view.clearSelection();
  setTimeout(() => mainLoop(), 80);
}

function askNewGame() {
  confirmBox('开始新游戏', '结束当前游戏，重新开始一局吗？', restartGame);
}

function optRules() {
  const defs = [
    ['constTwo', '2 为常主', '无论当前打什么牌，2 都算主牌。启用后起手级牌为 3。'],
    ['allowFanWuZhu', '允许反无主', '某家同时亮出四张王时，本局定为无主。'],
    ['allowZiFan', '允许自反', '亮牌者可再亮另一花色的一对级牌，改定主牌花色。'],
    ['allowDuiJiaBao', '允许对家保', '亮牌者的对家可亮出该花色的第二张级牌，锁定主牌花色。'],
    ['allowNoTrump', '打 A 后必打无主', '打过 A 之后须再打一副无主才算赢得全局。'],
  ];
  const box = el('div');
  for (const [key, label, note] of defs) {
    const row = el('div', 'opt-row');
    const id = 'opt_' + key;
    row.innerHTML = `<input type="checkbox" id="${id}" ${prefs.options[key] ? 'checked' : ''}>
      <label for="${id}"><b>${label}</b><small>${note}</small></label>`;
    box.appendChild(row);
  }
  box.appendChild(el('p', null, '规则改动将在下一副牌生效。')).style.color = '#9fb2b2';
  modal({
    title: '游戏规则', bodyNode: box,
    buttons: [{ label: '取消' }, {
      label: '确认', primary: true,
      onClick: (body) => {
        for (const [key] of defs) prefs.options[key] = $('#opt_' + key, body).checked;
        Object.assign(game.options, prefs.options);
        savePrefs(prefs);
      },
    }],
  });
}

function optChoice(title, key, labels) {
  const box = el('div', 'opt-grid');
  labels.forEach((label, i) => {
    const b = el('button', 'choice' + (prefs.options[key] === i ? ' on' : ''), label);
    b.addEventListener('click', () => {
      prefs.options[key] = i;
      Object.assign(game.options, prefs.options);
      savePrefs(prefs);
      [...box.children].forEach((c, j) => c.classList.toggle('on', i === j));
    });
    box.appendChild(b);
  });
  modal({ title, bodyNode: box });
}

function optFace() {
  const box = el('div', 'opt-grid');
  for (const f of FACES) {
    const b = el('button', 'choice' + (prefs.face === f.id ? ' on' : ''), f.label);
    b.addEventListener('click', () => {
      prefs.face = f.id; savePrefs(prefs);
      [...box.children].forEach((c, j) => c.classList.toggle('on', FACES[j].id === f.id));
      render();
    });
    box.appendChild(b);
  }
  modal({ title: '牌面图案', bodyNode: box });
}

function optBack() {
  const box = el('div', 'opt-grid');
  for (const b of BACKS) {
    const s = el('div', 'back-swatch' + (prefs.back === b.id ? ' on' : ''));
    s.title = b.label;
    s.style.backgroundImage = `url("assets/cards/${b.file}.svg")`;
    s.style.filter = b.filter;
    s.addEventListener('click', () => {
      prefs.back = b.id; savePrefs(prefs); view.applyBack();
      [...box.children].forEach((c, j) => c.classList.toggle('on', BACKS[j].id === b.id));
      render();
    });
    box.appendChild(s);
  }
  modal({ title: '牌背面图案', bodyNode: box });
}

function showHelp() { modal({ title: '游戏帮助', bodyHTML: RULES_HTML }); }

// ------------------------------------------------------------------ 启动

syncTicks();
render();
modal({
  title: '拖拉机大赛 · 网页版',
  bodyHTML: `<p>四人结对、抢分升级的经典扑克牌局。你坐 <b>南家</b>，北家是你的对家。</p>
    <p>按 <kbd>F1</kbd> 随时查看完整规则；左键选牌、双击出牌、右键选取同花色以左的所有牌。</p>
    <p style="color:#9fb2b2;font-size:.84rem">© 2026 TractorCard Project　版权所有，保留一切权利。未经授权不得使用、复制、修改或分发。</p>`,
  buttons: [{ label: '开始', primary: true }],
  onClose: () => { if (prefs.music) sfx.setMusic(true); mainLoop(); },
});
