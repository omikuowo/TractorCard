/*!
 * 拖拉机大赛 Web (TractorCard) — 规则引擎
 * Copyright (c) 2026 TractorCard Project. All rights reserved. 版权所有，保留一切权利。
 * 未经著作权人事先书面授权，不得使用、复制、修改、分发本软件或其任何部分。
 */
import { RANKS, SUITS, cardPoints } from './cards.js';

/**
 * 建立一局的主牌环境。
 * @param {string|null} trumpSuit 主花色；null 表示无主
 * @param {string} level 当前级牌（如 '10'）
 * @param {boolean} constTwo 是否启用“2 为常主”
 */
export function makeTrump(trumpSuit, level, constTwo) {
  const twoIsSpecial = constTwo && level !== '2';
  const skip = new Set([level]);
  if (twoIsSpecial) skip.add('2');

  // 主牌组由小到大的“档位”。同档位的牌大小相等，先出者为大。
  const trumpTiers = [];
  if (trumpSuit) for (const r of RANKS) if (!skip.has(r)) trumpTiers.push('T' + r);
  if (twoIsSpecial) {
    if (trumpSuit) { trumpTiers.push('2O'); trumpTiers.push('2T'); }
    else trumpTiers.push('2O');
  }
  if (trumpSuit) { trumpTiers.push('LO'); trumpTiers.push('LT'); }
  else trumpTiers.push('LO');
  trumpTiers.push('JS', 'JB');

  const trumpOrd = new Map(trumpTiers.map((t, i) => [t, i]));
  const sideRanks = RANKS.filter((r) => !skip.has(r));
  const sideOrd = new Map(sideRanks.map((r, i) => [r, i]));

  function tierOf(card) {
    if (card.suit === 'joker') return card.rank === 'big' ? 'JB' : 'JS';
    if (card.rank === level) return trumpSuit && card.suit === trumpSuit ? 'LT' : 'LO';
    if (twoIsSpecial && card.rank === '2') return trumpSuit && card.suit === trumpSuit ? '2T' : '2O';
    if (trumpSuit && card.suit === trumpSuit) return 'T' + card.rank;
    return null;
  }

  const ctx = {
    trumpSuit, level, constTwo: !!constTwo, twoIsSpecial,
    isTrump(card) { return tierOf(card) !== null; },
    /** 牌所属的“组”：'trump' 或某一门副牌花色。只有同组的牌才能比较、才能构成拖拉机。 */
    groupOf(card) { return tierOf(card) !== null ? 'trump' : card.suit; },
    /** 组内序号，越大越强。 */
    ordOf(card) {
      const t = tierOf(card);
      if (t !== null) return trumpOrd.get(t);
      return sideOrd.get(card.rank);
    },
    groupLength(group) { return group === 'trump' ? trumpTiers.length : sideRanks.length; },
    trumpTiers, sideRanks,
  };
  return ctx;
}

export const cardKey = (c) => `${c.suit}-${c.rank}`;

/** 手牌排序：主牌在最右，其余按固定花色顺序；组内由大到小。 */
export function sortHand(cards, ctx) {
  const groupRank = (g) => (g === 'trump' ? 9 : SUITS.indexOf(g));
  return cards.slice().sort((a, b) => {
    const ga = ctx.groupOf(a), gb = ctx.groupOf(b);
    if (ga !== gb) return groupRank(ga) - groupRank(gb);
    const d = ctx.ordOf(b) - ctx.ordOf(a);
    if (d) return d;
    return cardKey(a).localeCompare(cardKey(b));
  });
}

/**
 * 把一手同组的牌拆成拖拉机 / 对牌 / 单张。
 * 对牌必须是完全相同的两张牌；拖拉机是组内序号连续的若干对牌。
 */
export function decompose(cards, ctx) {
  const byKey = new Map();
  for (const c of cards) {
    if (!byKey.has(cardKey(c))) byKey.set(cardKey(c), []);
    byKey.get(cardKey(c)).push(c);
  }
  const pairs = [];  // { ord, cards:[a,b] }
  const singles = [];
  for (const list of byKey.values()) {
    let i = 0;
    for (; i + 1 < list.length; i += 2) pairs.push({ ord: ctx.ordOf(list[i]), cards: [list[i], list[i + 1]] });
    for (; i < list.length; i++) singles.push(list[i]);
  }
  pairs.sort((a, b) => a.ord - b.ord);

  // 连续序号的对牌组成拖拉机；同序号的两对（如两对副 10）不相连。
  const runs = [];
  let cur = null;
  for (const p of pairs) {
    if (cur && p.ord === cur.top + 1) { cur.pairs.push(p); cur.top = p.ord; }
    else { cur = { pairs: [p], top: p.ord }; runs.push(cur); }
  }
  const tractors = runs.filter((r) => r.pairs.length >= 2)
    .map((r) => ({ len: r.pairs.length, top: r.top, cards: r.pairs.flatMap((p) => p.cards) }));
  const lonePairs = runs.filter((r) => r.pairs.length === 1).map((r) => r.pairs[0]);

  return {
    tractors,                                   // 长度 >= 2 对
    pairs,                                      // 全部对牌（含拖拉机内的）
    lonePairs,                                  // 不在拖拉机内的对牌
    singles,
    pairCount: pairs.length,
    tractorPairCount: tractors.reduce((s, t) => s + t.len, 0),
    maxTractorLen: tractors.reduce((m, t) => Math.max(m, t.len), 0),
    topOrd: cards.length ? Math.max(...cards.map((c) => ctx.ordOf(c))) : -1,
  };
}

/** 一手出牌是否同组；同组才是合法的首攻形态。 */
export function singleGroup(cards, ctx) {
  if (!cards.length) return null;
  const g = ctx.groupOf(cards[0]);
  return cards.every((c) => ctx.groupOf(c) === g) ? g : null;
}

/** 描述首攻的形态，作为跟牌与比较的依据。 */
export function describeLead(cards, ctx) {
  const group = singleGroup(cards, ctx);
  const d = decompose(cards, ctx);
  return {
    group, cards: cards.slice(), count: cards.length,
    pairCount: d.pairCount, tractorPairCount: d.tractorPairCount, maxTractorLen: d.maxTractorLen,
    tractors: d.tractors, decomp: d,
    /** 比较依据：有拖拉机比拖拉机，有对牌比对牌，否则比单张。 */
    keyKind: d.maxTractorLen >= 2 ? 'tractor' : (d.pairCount >= 1 ? 'pair' : 'single'),
  };
}

/** 从若干张牌中按首攻形态取出“比较用”的关键序号；不满足形态返回 null。 */
export function keyOrdFor(lead, cards, ctx) {
  const d = decompose(cards, ctx);
  if (lead.keyKind === 'tractor') {
    const fit = d.tractors.filter((t) => t.len >= lead.maxTractorLen);
    if (!fit.length) return null;
    return Math.max(...fit.map((t) => t.top));
  }
  if (lead.keyKind === 'pair') {
    if (!d.pairCount) return null;
    return Math.max(...d.pairs.map((p) => p.ord));
  }
  return d.topOrd;
}

/**
 * 判断一手跟牌能否争夺本墩。
 * 同门跟牌须形态相符；无此门时全出主牌且拖拉机、对牌数量不少于首攻方为“毙”，
 * 否则视为垫牌，不参与比较。
 */
export function contendKey(lead, cards, ctx) {
  const g = singleGroup(cards, ctx);
  if (g === null) return null;
  if (g === lead.group) {
    const k = keyOrdFor(lead, cards, ctx);
    return k === null ? null : { trumped: false, key: k };
  }
  if (g !== 'trump' || lead.group === 'trump') return null;
  const d = decompose(cards, ctx);
  if (d.tractorPairCount < lead.tractorPairCount) return null;
  if (d.pairCount < lead.pairCount) return null;
  const k = keyOrdFor(lead, cards, ctx);
  return k === null ? null : { trumped: true, key: k };
}

/**
 * 结算一墩。plays 为按出牌顺序排列的 { seat, cards }，plays[0] 为首攻。
 * 同等大小以先出者为大。
 */
export function trickWinner(plays, ctx) {
  const lead = describeLead(plays[0].cards, ctx);
  let best = { seat: plays[0].seat, trumped: lead.group === 'trump', key: keyOrdFor(lead, plays[0].cards, ctx) ?? -1, index: 0 };
  for (let i = 1; i < plays.length; i++) {
    const r = contendKey(lead, plays[i].cards, ctx);
    if (!r) continue;
    if (r.trumped && !best.trumped) best = { seat: plays[i].seat, trumped: true, key: r.key, index: i };
    else if (r.trumped === best.trumped && r.key > best.key) best = { seat: plays[i].seat, trumped: r.trumped, key: r.key, index: i };
  }
  return { seat: best.seat, index: best.index, lead };
}

export function trickPoints(plays) {
  let s = 0;
  for (const p of plays) for (const c of p.cards) s += cardPoints(c);
  return s;
}
