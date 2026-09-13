/*!
 * 拖拉机大赛 Web (TractorCard) — 电脑玩家
 * Copyright (c) 2026 TractorCard Project. All rights reserved. 版权所有，保留一切权利。
 * 未经著作权人事先书面授权，不得使用、复制、修改、分发本软件或其任何部分。
 */
import { SUITS, cardPoints, pointsOf, RANKS } from './cards.js';
import { decompose, describeLead, contendKey, keyOrdFor, cardKey } from './rules.js';
import { followRequirement, buildFollow, components, validateFollow } from './play.js';
import { TEAM, PARTNER } from './game.js';

const rnd = (n) => Math.floor(Math.random() * n);

// ------------------------------------------------------------------ 亮牌

export function aiDeclare(game, seat) {
  const opts = game.declareOptions(seat);
  if (!opts.length) return null;
  const lv = game.options.difficulty;
  const hand = game.hands[seat];
  const dealt = hand.length;

  const nt = opts.find((o) => o.type === 'fanwuzhu');
  if (nt) return nt;                                   // 四王无主永远值得亮

  const suitPower = (s) => {
    let n = 0, j = 0;
    for (const c of hand) {
      if (c.suit === s) n++;
      else if (c.suit === 'joker') j++;
      else if (c.rank === game.level) n += 0.5;
    }
    return n + j * 1.2;
  };
  const best = opts
    .map((o) => ({ o, power: o.suit ? suitPower(o.suit) + (o.strength >= 2 ? 3 : 0) : 0 }))
    .sort((a, b) => b.power - a.power)[0];

  if (lv === 0) return Math.random() < 0.35 ? best.o : null;
  // 手牌越多越有把握；等到手上有一定张数再亮，避免亮错门。
  const need = lv === 2 ? 6.5 : 5.5;
  const patience = lv === 2 ? 10 : 6;
  if (dealt < patience && best.o.strength === 1 && Math.random() < 0.7) return null;
  if (best.o.strength >= 2) return best.power >= need - 1 ? best.o : null;
  return best.power >= need ? best.o : null;
}

// ------------------------------------------------------------------ 扣底

export function aiBury(game, seat) {
  const ctx = game.ctx, hand = game.hands[seat], lv = game.options.difficulty;
  const bySuit = {};
  for (const c of hand) if (ctx.groupOf(c) !== 'trump') (bySuit[c.suit] ||= []).push(c);

  const chosen = [];
  const take = (cs) => { for (const c of cs) if (chosen.length < 8 && !chosen.includes(c)) chosen.push(c); };

  if (lv >= 1) {
    // 扣光一门较短的副牌，便于日后毙牌。
    const shorts = Object.values(bySuit)
      .filter((cs) => cs.length <= 8 - chosen.length)
      .sort((a, b) => (a.length - b.length) || (pointsOf(a) - pointsOf(b)));
    for (const cs of shorts) {
      if (pointsOf(cs) > 0 && lv === 2) continue;
      if (chosen.length + cs.length <= 8) take(cs);
    }
  }
  // 其余按“最没用”排序补足：不扣分、不扣 A、不扣主牌。
  const score = (c) => {
    let s = ctx.ordOf(c);
    if (ctx.groupOf(c) === 'trump') s += 1000;
    s += cardPoints(c) * 40;
    if (c.rank === 'A') s += 60;
    const len = (bySuit[c.suit] || []).length;
    s += len * 2;
    return s;
  };
  const rest = hand.filter((c) => !chosen.includes(c)).sort((a, b) => score(a) - score(b));
  take(rest);
  return chosen.slice(0, 8);
}

// ------------------------------------------------------------------ 打牌

/** 某张牌在所属组里是否已是场上最大（用于高级电脑判断能否稳吃）。 */
function isTopRemaining(game, seat, card) {
  const ctx = game.ctx, g = ctx.groupOf(card), ord = ctx.ordOf(card);
  const known = new Set();
  for (const c of game.seen) known.add(c.id);
  for (const c of game.hands[seat]) known.add(c.id);
  let higher = 0;
  for (const suit of ['joker', ...SUITS]) {
    const ranks = suit === 'joker' ? ['small', 'big'] : RANKS;
    for (const rank of ranks) {
      for (let copy = 0; copy < 2; copy++) {
        const probe = { id: `${suit}-${rank}-${copy}`, suit, rank, copy };
        if (known.has(probe.id)) continue;
        if (ctx.groupOf(probe) !== g) continue;
        if (ctx.ordOf(probe) > ord) higher++;
      }
    }
  }
  return higher === 0;
}

export function aiLead(game, seat) {
  const ctx = game.ctx, hand = game.hands[seat], lv = game.options.difficulty;
  const others = [0, 1, 2, 3].filter((s) => s !== seat).map((s) => game.hands[s]);

  if (lv === 0) {
    const c = hand[rnd(hand.length)];
    const same = hand.filter((x) => cardKey(x) === cardKey(c));
    return same.length >= 2 && Math.random() < 0.5 ? same.slice(0, 2) : [c];
  }

  const groups = new Map();
  for (const c of hand) {
    const g = ctx.groupOf(c);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }

  const cands = [];
  for (const [g, cards] of groups) {
    const d = decompose(cards, ctx);
    const isTrump = g === 'trump';
    for (const t of d.tractors) cands.push({ cards: t.cards, kind: 'tractor', top: t.top, isTrump, size: t.cards.length });
    for (const p of d.lonePairs) cands.push({ cards: p.cards, kind: 'pair', top: p.ord, isTrump, size: 2 });
    for (const s of d.singles) cands.push({ cards: [s], kind: 'single', top: ctx.ordOf(s), isTrump, size: 1 });
  }

  const score = (c) => {
    let s = 0;
    const top = c.cards[0];
    const sure = lv === 2 ? isTopRemaining(game, seat, top) : ctx.ordOf(top) >= ctx.groupLength(ctx.groupOf(top)) - 2;
    if (sure) s += 100;                                  // 先出不易丧失出牌权的大牌
    s += c.kind === 'tractor' ? 40 : c.kind === 'pair' ? 22 : 0;
    s += c.top * 1.6;
    if (c.isTrump) s -= 55;                              // 不要先把主牌出光
    s += pointsOf(c.cards) * (sure ? 2.5 : -1.5);
    const remain = (groups.get(ctx.groupOf(top)) || []).length;
    if (!c.isTrump && remain <= 2 && !sure) s -= 20;      // 保留短套用来将来毙牌
    return s;
  };
  cands.sort((a, b) => score(b) - score(a));
  const pick = cands[0];

  // 高级电脑尝试甩牌：把同门中全部“吃不掉”的牌一次打出。
  if (lv === 2 && pick) {
    const g = ctx.groupOf(pick.cards[0]);
    const mine = groups.get(g) || [];
    const throwable = [];
    for (const comp of components(mine, ctx)) {
      if (!isBeatableBy(comp, others, g, ctx)) throwable.push(...comp.cards);
    }
    if (throwable.length > pick.cards.length) return throwable;
  }
  return pick ? pick.cards : [hand[0]];
}

function isBeatableBy(comp, hands, group, ctx) {
  for (const h of hands) {
    const same = h.filter((c) => ctx.groupOf(c) === group);
    if (!same.length) continue;
    const d = decompose(same, ctx);
    if (comp.kind === 'single') { if (d.topOrd > comp.top) return true; }
    else if (comp.kind === 'pair') { if (d.pairs.some((p) => p.ord > comp.top)) return true; }
    else if (d.tractors.some((t) => t.len >= comp.len && t.top > comp.top)) return true;
  }
  return false;
}

/** 生成若干合法的跟牌候选。 */
function followCandidates(game, seat) {
  const ctx = game.ctx, hand = game.hands[seat], lead = game.leadDescriptor;
  const req = followRequirement(hand, lead, ctx);
  const out = [];
  const push = (cs) => {
    if (!cs || cs.length !== req.n) return;
    if (!validateFollow(hand, lead, cs, ctx).ok) return;
    const key = cs.map((c) => c.id).sort().join('|');
    if (!out.some((o) => o.key === key)) out.push({ key, cards: cs });
  };
  push(buildFollow(hand, lead, ctx, 'low'));
  push(buildFollow(hand, lead, ctx, 'high'));

  if (req.n === 1) {
    const pool = req.own.length ? req.own : hand;
    for (const c of pool) push([c]);
  } else if (req.own.length === 0) {
    // 无此门：可全出主牌“毙”，也可垫牌。
    const trump = hand.filter((c) => ctx.groupOf(c) === 'trump');
    push(ruffSet(trump, lead, ctx, req.n));
    const side = hand.filter((c) => ctx.groupOf(c) !== 'trump');
    push(dumpSet(side.length >= req.n ? side : hand, ctx, req.n, 'points'));
    push(dumpSet(side.length >= req.n ? side : hand, ctx, req.n, 'safe'));
  }
  return { lead, req, candidates: out };
}

/** 用主牌凑出满足首攻形态的“毙牌”。 */
function ruffSet(trump, lead, ctx, n) {
  if (trump.length < n) return null;
  const d = decompose(trump, ctx);
  const picked = [];
  const used = new Set();
  const take = (cs) => { for (const c of cs) { used.add(c.id); picked.push(c); } };
  let needT = lead.tractorPairCount;
  for (const t of d.tractors.slice().sort((a, b) => a.top - b.top)) {
    if (needT <= 0) break;
    const k = Math.min(t.len, Math.max(2, needT));
    if (picked.length + k * 2 <= n) { take(t.cards.slice(0, k * 2)); needT -= k; }
  }
  if (needT > 0) return null;
  let needP = lead.pairCount - picked.length / 2;
  for (const p of d.pairs.slice().sort((a, b) => a.ord - b.ord)) {
    if (needP <= 0) break;
    if (p.cards.some((c) => used.has(c.id))) continue;
    if (picked.length + 2 > n) break;
    take(p.cards); needP--;
  }
  if (needP > 0) return null;
  const spare = trump.filter((c) => !used.has(c.id)).sort((a, b) => ctx.ordOf(a) - ctx.ordOf(b));
  for (const c of spare) { if (picked.length >= n) break; take([c]); }
  return picked.length === n ? picked : null;
}

/** 垫牌：'points' 尽量垫分给对家，'safe' 尽量垫废牌。 */
function dumpSet(pool, ctx, n, mode) {
  const score = (c) => {
    const base = ctx.ordOf(c) + (ctx.groupOf(c) === 'trump' ? 100 : 0);
    return mode === 'points' ? -(cardPoints(c) * 50) + base : cardPoints(c) * 50 + base;
  };
  const sorted = pool.slice().sort((a, b) => score(a) - score(b));
  return sorted.length >= n ? sorted.slice(0, n) : null;
}

export function aiFollow(game, seat) {
  const ctx = game.ctx, lv = game.options.difficulty;
  const { lead, candidates } = followCandidates(game, seat);
  if (!candidates.length) return buildFollow(game.hands[seat], lead, ctx, 'low');
  if (lv === 0) return candidates[rnd(candidates.length)].cards;

  const trick = game.currentTrick;
  const plays = trick.plays;
  const bestNow = currentBest(plays, ctx, lead);
  const partnerWinning = TEAM(bestNow.seat) === TEAM(seat);
  const isLast = plays.length === 3;
  const potPoints = plays.reduce((s, p) => s + pointsOf(p.cards), 0);

  let best = null, bestScore = -Infinity;
  for (const { cards } of candidates) {
    const r = contendKey(lead, cards, ctx);
    const wins = r && beats(r, bestNow, ctx);
    const myPts = pointsOf(cards);
    let s = 0;
    if (wins) {
      s += 60 + potPoints * 3;
      if (!isLast) s -= 12;                      // 后面还有人，可能被盖
      s -= cards.filter((c) => ctx.groupOf(c) === 'trump').length * 4;
      s -= keyOf(r) * 0.8;                       // 能吃就用小的吃
    } else if (partnerWinning) {
      s += myPts * 6;                            // 对家做庄，垫分给对家
      if (isLast) s += myPts * 3;
      s -= ctx.groupOf(cards[0]) === 'trump' ? 20 : 0;
    } else {
      s -= myPts * 8;                            // 别把分送给对方
      s -= cards.reduce((a, c) => a + ctx.ordOf(c), 0) * 0.35;
      s -= cards.filter((c) => ctx.groupOf(c) === 'trump').length * 10;
    }
    if (lv === 2 && wins && potPoints === 0 && !isLast) s -= 18;
    if (s > bestScore) { bestScore = s; best = cards; }
  }
  return best || candidates[0].cards;
}

const keyOf = (r) => r.key + (r.trumped ? 1000 : 0);
function beats(r, bestNow, ctx) {
  if (r.trumped && !bestNow.trumped) return true;
  if (r.trumped === bestNow.trumped) return r.key > bestNow.key;
  return false;
}
function currentBest(plays, ctx, lead) {
  let best = { seat: plays[0].seat, trumped: lead.group === 'trump', key: keyOrdFor(lead, plays[0].cards, ctx) ?? -1 };
  for (let i = 1; i < plays.length; i++) {
    const r = contendKey(lead, plays[i].cards, ctx);
    if (!r) continue;
    if (beats(r, best, ctx)) best = { seat: plays[i].seat, trumped: r.trumped, key: r.key };
  }
  return best;
}

export function aiPlay(game, seat) {
  return game.leadDescriptor ? aiFollow(game, seat) : aiLead(game, seat);
}
