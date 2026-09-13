/*!
 * 拖拉机大赛 Web (TractorCard) — 牌局状态机
 * Copyright (c) 2026 TractorCard Project. All rights reserved. 版权所有，保留一切权利。
 * 未经著作权人事先书面授权，不得使用、复制、修改、分发本软件或其任何部分。
 */
import { buildDeck, shuffle, pointsOf, RANKS, SUITS, cardPoints } from './cards.js';
import { makeTrump, sortHand, describeLead, trickWinner, decompose } from './rules.js';
import { validateFollow, validateLead, components } from './play.js';

export const TEAM = (seat) => seat % 2;           // 0 队：座位 0/2；1 队：座位 1/3
export const PARTNER = (seat) => (seat + 2) % 4;
export const NEXT = (seat) => (seat + 1) % 4;

export const DEFAULT_OPTIONS = {
  constTwo: false,        // 2 为常主
  allowFanWuZhu: true,    // 允许反无主（四王定无主）
  allowZiFan: true,       // 允许自反
  allowDuiJiaBao: true,   // 允许对家保
  allowNoTrump: true,     // 打 A 后必打无主
  difficulty: 1,          // 0 低级 / 1 中级 / 2 高级
  speed: 1,               // 0 慢 / 1 中 / 2 快
};

/** 必打的级牌：跳级时不可跳过。 */
function mandatoryLevels(options) {
  return new Set([options.constTwo ? '3' : '2', 'J', 'A']);
}
function levelList(options) {
  return options.constTwo ? RANKS.filter((r) => r !== '2') : RANKS.slice();
}

export class TractorGame {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.rng = Math.random;
    this.listeners = new Set();
    this.reset();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, payload) { for (const fn of this.listeners) fn(type, payload); }

  reset() {
    const list = levelList(this.options);
    this.levels = [list[0], list[0]];     // 两队当前级别
    this.noTrumpPending = [false, false]; // 打完 A 后待打无主
    this.dealerSeat = null;
    this.handNo = 0;
    this.phase = 'idle';
    this.log = [];
  }

  // ---------------------------------------------------------------- 发牌与亮牌

  newHand() {
    const opts = this.options;
    this.handNo++;
    const firstHand = this.dealerSeat === null;
    const dealTeam = firstHand ? null : TEAM(this.dealerSeat);
    this.isNoTrumpHand = !firstHand && this.noTrumpPending[dealTeam];
    this.level = firstHand ? this.levels[0] : this.levels[dealTeam];

    const deck = shuffle(buildDeck(), this.rng);
    this.kitty = deck.slice(0, 8);
    this.pending = deck.slice(8);
    this.hands = [[], [], [], []];
    this.dealIndex = 0;
    this.dealSeat = firstHand ? 0 : this.dealerSeat;
    this.declaration = null;      // { seat, suit|null, strength, cards }
    this.trumpSuit = undefined;
    this.tricks = [];
    this.currentTrick = null;
    this.defenderPoints = 0;
    this.kittyMultiplier = 0;
    this.seen = [];               // 已出现过的牌，供 AI 记牌
    this.phase = 'dealing';
    this.result = null;
    this.emit('hand-start', { handNo: this.handNo, level: this.level, dealerSeat: this.dealerSeat });
    return this;
  }

  /** 发一张牌。返回 { seat, card } 或 null 表示发完。 */
  dealStep() {
    if (!this.pending.length) { this.phase = 'declare-close'; return null; }
    const card = this.pending.shift();
    const seat = this.dealSeat;
    this.hands[seat].push(card);
    this.dealSeat = NEXT(this.dealSeat);
    this.emit('deal', { seat, card });
    return { seat, card };
  }

  get dealingDone() { return this.pending.length === 0; }

  /** 本局的级牌点数（无主局仍以 A 为级牌）。 */
  get levelRank() { return this.level; }

  /** 某座位当前可以亮出的牌。 */
  declareOptions(seat) {
    if (this.isNoTrumpHand) return [];
    const opts = this.options;
    const hand = this.hands[seat];
    const lvl = this.level;
    const out = [];
    const bySuit = {};
    for (const c of hand) if (c.rank === lvl && c.suit !== 'joker') (bySuit[c.suit] ||= []).push(c);
    const jokers = hand.filter((c) => c.suit === 'joker');
    const d = this.declaration;

    const addNT = () => {
      if (!opts.allowFanWuZhu) return;
      if (jokers.length >= 4) out.push({ type: 'fanwuzhu', suit: null, strength: 3, cards: jokers.slice(0, 4), label: '反无主（四王）' });
    };

    if (!d) {
      for (const s of SUITS) {
        const cs = bySuit[s] || [];
        if (cs.length >= 2) out.push({ type: 'pair', suit: s, strength: 2, cards: cs.slice(0, 2), label: '亮一对' });
        if (cs.length >= 1) out.push({ type: 'single', suit: s, strength: 1, cards: cs.slice(0, 1), label: '亮牌' });
      }
      addNT();
      return out;
    }
    if (d.strength >= 3) return [];
    if (d.strength === 1) {
      const sameSuit = (bySuit[d.suit] || []).filter((c) => !d.cards.some((x) => x.id === c.id));
      if (seat === d.seat && sameSuit.length >= 1) {
        out.push({ type: 'zibao', suit: d.suit, strength: 2, cards: [...d.cards, sameSuit[0]], label: '自保' });
      }
      if (opts.allowDuiJiaBao && seat === PARTNER(d.seat) && sameSuit.length >= 1) {
        out.push({ type: 'duijiabao', suit: d.suit, strength: 2, cards: [...d.cards, sameSuit[0]], label: '对家保' });
      }
      for (const s of SUITS) {
        if (s === d.suit) continue;
        const cs = bySuit[s] || [];
        if (cs.length < 2) continue;
        if (seat === d.seat) { if (opts.allowZiFan) out.push({ type: 'zifan', suit: s, strength: 2, cards: cs.slice(0, 2), label: '自反' }); }
        else out.push({ type: 'fanzhu', suit: s, strength: 2, cards: cs.slice(0, 2), label: '反主' });
      }
    }
    addNT();
    return out;
  }

  declare(seat, option) {
    const valid = this.declareOptions(seat).some((o) => o.type === option.type && o.suit === option.suit);
    if (!valid) return false;
    // 对家保由对家亮出，但庄家资格仍归先亮的一方（先亮者为庄家）。
    const holder = option.type === 'duijiabao' ? this.declaration.seat : seat;
    this.declaration = { seat: holder, by: seat, suit: option.suit, strength: option.strength, type: option.type, cards: option.cards };
    this.emit('declare', { seat, option, declaration: this.declaration });
    return true;
  }

  /** 发牌结束后定主、定庄，并把底牌交给庄家。 */
  closeDeal() {
    let revealed = null;
    if (this.isNoTrumpHand) {
      this.trumpSuit = null;
    } else if (this.declaration) {
      this.trumpSuit = this.declaration.suit;
    } else {
      // 无人亮牌：翻底牌第三张定主；若为王则顺次向后翻。
      for (let i = 2; i < this.kitty.length; i++) {
        if (this.kitty[i].suit !== 'joker') { this.trumpSuit = this.kitty[i].suit; revealed = this.kitty[i]; break; }
      }
      if (this.trumpSuit === undefined) this.trumpSuit = this.kitty[0].suit;
    }
    if (this.dealerSeat === null) this.dealerSeat = this.declaration ? this.declaration.seat : 0;
    this.ctx = makeTrump(this.trumpSuit, this.level, this.options.constTwo);
    this.hands = this.hands.map((h) => sortHand(h, this.ctx));
    this.hands[this.dealerSeat] = sortHand(this.hands[this.dealerSeat].concat(this.kitty), this.ctx);
    this.kitty = [];
    this.phase = 'bury';
    this.emit('deal-closed', { trumpSuit: this.trumpSuit, dealerSeat: this.dealerSeat, revealed });
    return { trumpSuit: this.trumpSuit, dealerSeat: this.dealerSeat, revealed };
  }

  /** 庄家扣底八张。 */
  bury(seat, cards) {
    if (this.phase !== 'bury' || seat !== this.dealerSeat) return { ok: false, reason: '现在不是扣底阶段' };
    if (cards.length !== 8) return { ok: false, reason: '必须扣八张底牌' };
    const ids = new Set(cards.map((c) => c.id));
    if (ids.size !== 8 || !cards.every((c) => this.hands[seat].some((h) => h.id === c.id))) {
      return { ok: false, reason: '底牌必须来自手牌' };
    }
    this.kitty = cards.slice();
    this.hands[seat] = this.hands[seat].filter((c) => !ids.has(c.id));
    this.phase = 'playing';
    this.leadSeat = this.dealerSeat;
    this.currentTrick = { plays: [], leadSeat: this.leadSeat };
    this.emit('bury', { seat, cards });
    this.emit('trick-start', { leadSeat: this.leadSeat });
    return { ok: true };
  }

  // -------------------------------------------------------------------- 打牌

  get turnSeat() {
    if (this.phase !== 'playing' || !this.currentTrick) return null;
    return (this.currentTrick.leadSeat + this.currentTrick.plays.length) % 4;
  }

  get leadDescriptor() {
    const t = this.currentTrick;
    if (!t || !t.plays.length) return null;
    return describeLead(t.plays[0].cards, this.ctx);
  }

  /** 校验某座位的一手出牌。 */
  validate(seat, cards) {
    if (this.phase !== 'playing') return { ok: false, reason: '现在不能出牌' };
    if (seat !== this.turnSeat) return { ok: false, reason: '还没轮到你' };
    const hand = this.hands[seat];
    if (!cards.length || !cards.every((c) => hand.some((h) => h.id === c.id))) return { ok: false, reason: '请选择手中的牌' };
    const lead = this.leadDescriptor;
    if (!lead) {
      const others = [0, 1, 2, 3].filter((s) => s !== seat).map((s) => this.hands[s]);
      return validateLead(cards, others, this.ctx);
    }
    return validateFollow(hand, lead, cards, this.ctx);
  }

  play(seat, cards) {
    const v = this.validate(seat, cards);
    if (!v.ok) return v;
    const ids = new Set(cards.map((c) => c.id));
    this.hands[seat] = this.hands[seat].filter((c) => !ids.has(c.id));
    this.currentTrick.plays.push({ seat, cards: cards.slice() });
    for (const c of cards) this.seen.push(c);
    this.emit('play', { seat, cards });
    if (this.currentTrick.plays.length === 4) this._finishTrick();
    return { ok: true };
  }

  _finishTrick() {
    const t = this.currentTrick;
    const { seat: winner, lead } = trickWinner(t.plays, this.ctx);
    const pts = t.plays.reduce((s, p) => s + pointsOf(p.cards), 0);
    t.winner = winner; t.points = pts;
    this.tricks.push(t);
    const defender = TEAM(winner) !== TEAM(this.dealerSeat);
    if (defender) this.defenderPoints += pts;
    this.emit('trick-end', { winner, points: pts, defender, trick: t });

    if (this.hands.every((h) => h.length === 0)) {
      this._finishHand(winner, t);
    } else {
      this.currentTrick = { plays: [], leadSeat: winner };
      this.emit('trick-start', { leadSeat: winner });
    }
  }

  _finishHand(lastWinner, lastTrick) {
    const kittyPts = pointsOf(this.kitty);
    let bonus = 0, mult = 0;
    if (TEAM(lastWinner) !== TEAM(this.dealerSeat) && kittyPts >= 0) {
      // 抠底：单张乘二、对牌乘四、拖拉机乘八、三拖乘十六，其余类推。
      const winPlay = lastTrick.plays.find((p) => p.seat === lastWinner);
      const comps = components(winPlay.cards, this.ctx);
      const biggest = comps.reduce((m, c) => (c.cards.length > m.cards.length ? c : m), comps[0]);
      const pairs = biggest.kind === 'single' ? 0 : biggest.cards.length / 2;
      mult = Math.pow(2, pairs + 1);
      bonus = kittyPts * mult;
      this.defenderPoints += bonus;
      this.kittyMultiplier = mult;
    }
    this.phase = 'hand-over';
    this.result = this._score(this.defenderPoints, kittyPts, bonus, mult, lastWinner);
    this.emit('hand-end', this.result);
  }

  /** 按原版升级规则结算。 */
  _score(pts, kittyPts, kittyBonus, kittyMult, lastWinner) {
    const dealTeam = TEAM(this.dealerSeat);
    const defTeam = 1 - dealTeam;
    let winnerTeam, steps, desc, nextDealer;
    if (pts === 0) { winnerTeam = dealTeam; steps = 3; desc = '大光'; }
    else if (pts < 40) { winnerTeam = dealTeam; steps = 2; desc = '小光'; }
    else if (pts < 80) { winnerTeam = dealTeam; steps = 1; desc = '庄家升一级'; }
    else {
      winnerTeam = defTeam;
      steps = Math.floor((pts - 80) / 40);
      desc = steps === 0 ? '闲家上台' : `闲家上台并升${steps}级`;
    }
    nextDealer = winnerTeam === dealTeam ? PARTNER(this.dealerSeat) : NEXT(this.dealerSeat);

    const before = this.levels[winnerTeam];
    const wasNoTrump = this.isNoTrumpHand;
    let after = before, matchOver = false, needNoTrump = this.noTrumpPending[winnerTeam];

    if (wasNoTrump) {
      if (winnerTeam === dealTeam) { matchOver = true; needNoTrump = false; }
    } else if (steps > 0 || winnerTeam !== dealTeam) {
      const r = advanceLevel(before, steps, this.options);
      after = r.level;
      if (r.past) {
        if (this.options.allowNoTrump) needNoTrump = true;
        else matchOver = true;
      }
    }
    this.levels[winnerTeam] = after;
    this.noTrumpPending[winnerTeam] = needNoTrump && !matchOver;

    return {
      handNo: this.handNo, level: this.level, trumpSuit: this.trumpSuit, dealerSeat: this.dealerSeat,
      dealTeam, defTeam, defenderPoints: pts, kittyPoints: kittyPts, kittyBonus, kittyMultiplier: kittyMult,
      lastWinner, winnerTeam, steps, desc, nextDealer, levelBefore: before, levelAfter: after,
      noTrumpPending: this.noTrumpPending.slice(), matchOver, wasNoTrump,
      levels: this.levels.slice(),
    };
  }

  /** 进入下一副牌。 */
  advanceHand() {
    if (!this.result || this.result.matchOver) return false;
    this.dealerSeat = this.result.nextDealer;
    return true;
  }
}

/**
 * 升级：必打的级牌（2 或 3、J、A）在跳级中不可跳过。
 * 返回 { level, past }，past 为真表示已打过 A。
 */
export function advanceLevel(from, steps, options) {
  const list = levelList(options);
  const must = mandatoryLevels(options);
  let i = list.indexOf(from);
  if (steps <= 0) return { level: from, past: false };
  let target = i + steps;
  for (let j = i + 1; j < Math.min(target, list.length); j++) {
    if (must.has(list[j])) { target = j; break; }
  }
  if (target >= list.length) return { level: list[list.length - 1], past: true };
  return { level: list[target], past: false };
}
