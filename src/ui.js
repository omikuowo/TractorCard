/*!
 * 拖拉机大赛 网页版 — 界面渲染与交互
 * Copyright (c) 2026 TractorCard Project. All rights reserved. 版权所有，保留一切权利。
 * 未经著作权人事先书面授权，不得使用、复制、修改、分发本作品或其任何部分。
 */
import { cardImage, cardLabel, SUIT_CN, SUIT_SYM, RANK_CN, pointsOf } from './cards.js';
import { sortHand, cardKey } from './rules.js';
import { TEAM } from './game.js';

export const SEAT_NAME = ['你（南）', '西家', '对家（北）', '东家'];
export const SEAT_SHORT = ['南', '西', '北', '东'];
export const BACKS = [
  { id: 'navy', label: '藏青', file: 'back-navy', filter: 'none' },
  { id: 'burgundy', label: '酒红', file: 'back-burgundy', filter: 'none' },
  { id: 'forest', label: '墨绿', file: 'back-navy', filter: 'hue-rotate(96deg) saturate(1.15)' },
  { id: 'plum', label: '紫檀', file: 'back-burgundy', filter: 'hue-rotate(-46deg) saturate(1.1)' },
  { id: 'slate', label: '石墨', file: 'back-navy', filter: 'grayscale(.85) brightness(1.05)' },
];
export const FACES = [
  { id: 'classic', label: '普通（图形牌面）' },
  { id: 'plain', label: '简约（大字牌面）' },
];

export const cardSrc = (card) => `assets/cards/${cardImage(card)}.svg`;

export function $(sel, root = document) { return root.querySelector(sel); }
export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** 渲染一张牌。face 为 false 时显示牌背。 */
export function cardNode(card, { face = true, faceStyle = 'classic', extra = '' } = {}) {
  const n = el('div', `card ${extra}`.trim());
  if (!face) { n.classList.add('back'); n.setAttribute('aria-label', '牌背'); return n; }
  n.dataset.id = card.id;
  n.setAttribute('aria-label', cardLabel(card));
  if (faceStyle === 'plain') {
    n.classList.add('plain');
    const red = card.suit === 'hearts' || card.suit === 'diamonds' || (card.suit === 'joker' && card.rank === 'big');
    n.style.background = '#fffef9';
    n.style.color = red ? '#b54450' : '#172831';
    n.style.display = 'grid';
    n.style.placeItems = 'center';
    n.style.border = '1px solid #c2bda8';
    n.style.fontWeight = '700';
    n.style.fontSize = 'calc(var(--card-w) * 0.34)';
    n.textContent = card.suit === 'joker' ? RANK_CN[card.rank] : SUIT_SYM[card.suit] + card.rank;
  } else {
    n.style.backgroundImage = `url("${cardSrc(card)}")`;
  }
  return n;
}

export class TableView {
  constructor(root, prefs) {
    this.root = root;
    this.prefs = prefs;
    this.hand = $('#hand');
    this.board = $('#board');
    this.status = $('#status');
    this.scoreboard = $('#scoreboard');
    this.declareBar = $('#declareBar');
    this.hint = $('#hint');
    this.playBtn = $('#playBtn');
    this.banner = $('#trickBanner');
    this.kitty = $('#kitty');
    this.selected = new Set();
    this.applyBack();
  }

  applyBack() {
    const b = BACKS.find((x) => x.id === this.prefs.back) || BACKS[0];
    document.documentElement.style.setProperty('--back-image', `url("assets/cards/${b.file}.svg")`);
    document.documentElement.style.setProperty('--back-filter', b.filter);
  }

  setHint(text, warn = false) {
    this.hint.textContent = text || '';
    this.hint.classList.toggle('warn', !!warn);
  }

  flashBanner(text, ms = 1100) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { this.banner.hidden = true; }, ms);
  }

  // -------------------------------------------------------------- 手牌

  renderHand(cards, ctx, { selectable = true, onToggle, onDouble, onRange } = {}) {
    this.hand.innerHTML = '';
    this._handCards = cards;
    const face = this.prefs.face;
    let prevGroup = null;
    cards.forEach((card, i) => {
      const g = ctx ? ctx.groupOf(card) : card.suit;
      const n = cardNode(card, { faceStyle: face });
      if (prevGroup !== null && g !== prevGroup) n.classList.add('group-start');
      prevGroup = g;
      if (this.selected.has(card.id)) n.classList.add('selected');
      if (selectable) {
        n.addEventListener('click', (e) => { e.preventDefault(); onToggle && onToggle(card); });
        n.addEventListener('dblclick', (e) => { e.preventDefault(); onDouble && onDouble(card); });
        n.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          onRange && onRange(card, i, e.detail >= 2);
        });
      } else n.classList.add('dimmed');
      this.hand.appendChild(n);
    });
  }

  refreshSelection() {
    for (const n of this.hand.children) {
      if (!n.dataset.id) continue;
      n.classList.toggle('selected', this.selected.has(n.dataset.id));
    }
  }

  clearSelection() { this.selected.clear(); this.refreshSelection(); }
  get selectedIds() { return [...this.selected]; }

  // -------------------------------------------------------------- 牌桌

  renderSeats(game, { humanSeat = 0, turnSeat = null, dealing = false } = {}) {
    for (const seatEl of this.root.querySelectorAll('.seat')) {
      const s = Number(seatEl.dataset.seat);
      const tag = $('.tag', seatEl), count = $('.count', seatEl);
      const lvl = game.levels ? game.levels[TEAM(s)] : '2';
      tag.textContent = `${SEAT_NAME[s]} · ${lvl}`;
      seatEl.classList.toggle('is-turn', turnSeat === s);
      seatEl.classList.toggle('is-dealer', game.dealerSeat === s);
      count.textContent = game.hands ? `${game.hands[s].length} 张` : '';
      const played = $('.played', seatEl);
      played.innerHTML = '';
      if (s !== humanSeat) {
        const n = game.hands ? game.hands[s].length : 0;
        played.className = 'played minifan';
        for (let i = 0; i < Math.min(n, 6); i++) played.appendChild(cardNode(null, { face: false, extra: 'mini' }));
      }
    }
  }

  renderTrick(trick, ctx) {
    this.board.innerHTML = '';
    if (!trick) return;
    for (const p of trick.plays) {
      const slot = el('div', 'slot');
      slot.dataset.seat = String(p.seat);
      for (const c of sortHand(p.cards, ctx)) slot.appendChild(cardNode(c, { faceStyle: this.prefs.face }));
      this.board.appendChild(slot);
    }
  }

  renderKitty(cards, { hidden = false } = {}) {
    if (!cards || !cards.length) { this.kitty.hidden = true; return; }
    this.kitty.hidden = false;
    const box = $('.kitty-cards', this.kitty);
    box.innerHTML = '';
    for (const c of cards) box.appendChild(cardNode(c, { face: !hidden, faceStyle: this.prefs.face, extra: 'mini' }));
  }

  renderStatus(game) {
    const bits = [];
    if (game.level) bits.push(`本局打 <b>${game.level}</b>`);
    if (game.trumpSuit !== undefined) {
      bits.push(`主牌 <b>${game.trumpSuit === null ? '无主' : SUIT_CN[game.trumpSuit] + SUIT_SYM[game.trumpSuit]}</b>`);
    }
    if (game.dealerSeat != null) bits.push(`庄家 <b>${SEAT_SHORT[game.dealerSeat]}</b>`);
    if (game.phase === 'dealing') {
      const d = game.declaration;
      bits.push(d
        ? `亮牌 <b>${SEAT_SHORT[d.by ?? d.seat]}家 ${d.suit === null ? '无主' : SUIT_CN[d.suit] + SUIT_SYM[d.suit]}</b>`
        : '亮牌 <b>无</b>');
    }
    this.status.innerHTML = bits.map((b) => `<span>${b}</span>`).join('');
  }

  renderScore(game, humanSeat = 0) {
    const lv = game.levels || ['2', '2'];
    const myTeam = TEAM(humanSeat);
    const dealerTeam = game.dealerSeat == null ? null : TEAM(game.dealerSeat);
    const need = dealerTeam === null ? null : (dealerTeam === myTeam ? '你方坐庄' : '你方为闲家');
    const rows = [
      `<div class="row"><span class="us">我方（南北）</span><span>${lv[myTeam]}</span></div>`,
      `<div class="row"><span class="them">对方（东西）</span><span>${lv[1 - myTeam]}</span></div>`,
    ];
    if (game.phase === 'playing' || game.phase === 'hand-over') {
      rows.push(`<div class="row"><span>闲家得分</span><span>${game.defenderPoints} / 200</span></div>`);
      rows.push(`<div class="row"><span>已打墩数</span><span>${game.tricks.length} / 25</span></div>`);
    }
    this.scoreboard.innerHTML = `<h4>${need || '拖拉机'}</h4>` + rows.join('');
  }

  // -------------------------------------------------------------- 亮牌栏

  showDeclare(options, { onPick, onPass, current }) {
    this.declareBar.hidden = false;
    this.declareBar.innerHTML = '';
    const h = el('h4', null, '亮牌');
    this.declareBar.appendChild(h);
    if (current) {
      const who = el('div', null, `当前：${SEAT_SHORT[current.by ?? current.seat]} ${current.suit === null ? '反无主' : SUIT_CN[current.suit] + SUIT_SYM[current.suit]}`);
      who.style.fontSize = '.8rem';
      this.declareBar.appendChild(who);
    }
    const box = el('div', 'opts');
    for (const o of options) {
      const label = o.suit === null ? o.label : `${o.label} ${SUIT_SYM[o.suit]}`;
      const b = el('button', o.suit === 'hearts' || o.suit === 'diamonds' ? 'red' : null, label);
      b.addEventListener('click', () => onPick(o));
      box.appendChild(b);
    }
    const pass = el('button', 'pass', '不亮');
    pass.addEventListener('click', onPass);
    box.appendChild(pass);
    this.declareBar.appendChild(box);
  }

  hideDeclare() { this.declareBar.hidden = true; this.declareBar.innerHTML = ''; }
}

// ------------------------------------------------------------------ 对话框

export function modal({ title, bodyHTML, bodyNode, buttons = [{ label: '确认', primary: true }], onClose }) {
  const root = $('#modalRoot');
  root.hidden = false;
  root.innerHTML = '';
  const box = el('div', 'modal');
  box.appendChild(el('header', null, title));
  const body = el('div', 'body');
  if (bodyNode) body.appendChild(bodyNode); else body.innerHTML = bodyHTML || '';
  box.appendChild(body);
  const foot = el('footer');
  const close = (value) => { root.hidden = true; root.innerHTML = ''; onClose && onClose(value); };
  for (const b of buttons) {
    const btn = el('button', b.primary ? 'primary' : null, b.label);
    btn.addEventListener('click', () => { if (b.onClick && b.onClick(body) === false) return; close(b.value ?? b.label); });
    foot.appendChild(btn);
  }
  box.appendChild(foot);
  root.appendChild(box);
  root.addEventListener('click', (e) => { if (e.target === root && buttons.length <= 1) close(null); }, { once: true });
  return { close, body };
}

export function confirmBox(title, text, onYes) {
  modal({
    title, bodyHTML: `<p>${text}</p>`,
    buttons: [
      { label: '取消', value: false },
      { label: '确定', primary: true, value: true },
    ],
    onClose: (v) => { if (v === true) onYes(); },
  });
}
