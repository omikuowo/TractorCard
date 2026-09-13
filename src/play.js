/*!
 * 拖拉机大赛 Web (TractorCard) — 出牌合法性与甩牌判定
 * Copyright (c) 2026 TractorCard Project. All rights reserved. 版权所有，保留一切权利。
 * 未经著作权人事先书面授权，不得使用、复制、修改、分发本软件或其任何部分。
 */
import { decompose, describeLead, singleGroup, cardKey } from './rules.js';

const pairsOf = (d) => d.pairCount;

/** 从 n 张牌里最多能凑出的对子数。 */
function maxPairs(d, n) { return Math.min(d.pairCount, Math.floor(n / 2)); }

/** 从 n 张牌里最多能凑出的、位于拖拉机内的对子数。 */
function maxTractorPairs(d, n) {
  let budget = Math.floor(n / 2), got = 0;
  for (const t of d.tractors.slice().sort((a, b) => b.len - a.len)) {
    const take = Math.min(t.len, budget);
    if (take >= 2) { got += take; budget -= take; }
  }
  return got;
}

/**
 * 计算跟牌要求。
 * 有首攻花色（组）时必须先出该组的牌；首攻有对牌 / 拖拉机时，
 * 手中有对牌 / 拖拉机的必须跟出（包括拖拉机中的对牌）。
 */
export function followRequirement(hand, lead, ctx) {
  const n = lead.count;
  const own = hand.filter((c) => ctx.groupOf(c) === lead.group);
  const d = decompose(own, ctx);
  const fromGroup = Math.min(own.length, n);
  return {
    n, group: lead.group, own, fromGroup,
    reqPairs: Math.min(lead.pairCount, maxPairs(d, fromGroup)),
    reqTractorPairs: Math.min(lead.tractorPairCount, maxTractorPairs(d, fromGroup)),
  };
}

/** 校验一手跟牌是否合法。返回 { ok, reason }。 */
export function validateFollow(hand, lead, sel, ctx) {
  const req = followRequirement(hand, lead, ctx);
  if (sel.length !== req.n) return { ok: false, reason: `请出 ${req.n} 张牌` };
  const inGroup = sel.filter((c) => ctx.groupOf(c) === lead.group);
  if (inGroup.length < req.fromGroup) {
    return { ok: false, reason: `手中还有${req.group === 'trump' ? '主牌' : '该花色的牌'}，必须先跟` };
  }
  const d = decompose(inGroup, ctx);
  if (d.tractorPairCount < req.reqTractorPairs) return { ok: false, reason: '首攻是拖拉机，手中有拖拉机必须跟出' };
  if (pairsOf(d) < req.reqPairs) return { ok: false, reason: '首攻有对牌，手中有对牌必须跟出' };
  return { ok: true };
}

/** 校验首攻（含甩牌）。otherHands 为其余三家的手牌，用于判断甩牌是否成立。 */
export function validateLead(sel, otherHands, ctx) {
  if (!sel.length) return { ok: false, reason: '请选择要出的牌' };
  const group = singleGroup(sel, ctx);
  if (group === null) return { ok: false, reason: '首攻必须出同一门花色（或全部主牌）' };
  const lead = describeLead(sel, ctx);
  const comps = components(sel, ctx);
  if (comps.length <= 1) return { ok: true, lead };

  // 甩牌：每一“联”都必须是其余各家吃不掉的，否则强制只出其中最小的一联。
  const beaten = comps.filter((comp) => comps.some(() => false) || isBeatable(comp, otherHands, group, ctx));
  if (!beaten.length) return { ok: true, lead, thrown: true };
  beaten.sort((a, b) => (a.ord - b.ord) || (a.cards.length - b.cards.length));
  return { ok: false, reason: '甩牌不成立，必须出其中最小的一联', forced: beaten[0].cards };
}

/** 把一手同组的牌拆成“联”：拖拉机、对牌、单张。 */
export function components(cards, ctx) {
  const d = decompose(cards, ctx);
  const out = [];
  for (const t of d.tractors) out.push({ kind: 'tractor', len: t.len, ord: t.top - t.len + 1, top: t.top, cards: t.cards });
  for (const p of d.lonePairs) out.push({ kind: 'pair', len: 1, ord: p.ord, top: p.ord, cards: p.cards });
  for (const s of d.singles) out.push({ kind: 'single', len: 0, ord: ctx.ordOf(s), top: ctx.ordOf(s), cards: [s] });
  return out;
}

function isBeatable(comp, otherHands, group, ctx) {
  for (const hand of otherHands) {
    const same = hand.filter((c) => ctx.groupOf(c) === group);
    if (!same.length) continue;
    const d = decompose(same, ctx);
    if (comp.kind === 'single') { if (d.topOrd > comp.top) return true; }
    else if (comp.kind === 'pair') { if (d.pairs.some((p) => p.ord > comp.top)) return true; }
    else if (d.tractors.some((t) => t.len >= comp.len && t.top > comp.top)) return true;
  }
  return false;
}

/**
 * 自动补一手合法的跟牌（供 AI 与“提示”使用）。
 * pick(candidates) 在若干同样合法的候选中选择，返回牌数组。
 */
export function buildFollow(hand, lead, ctx, prefer = 'low') {
  const req = followRequirement(hand, lead, ctx);
  const own = req.own.slice();
  const rest = hand.filter((c) => ctx.groupOf(c) !== lead.group);
  const chosen = [];

  if (own.length) {
    const d = decompose(own, ctx);
    const used = new Set();
    const take = (cards) => { for (const c of cards) { used.add(c.id); chosen.push(c); } };
    let needT = req.reqTractorPairs;
    for (const t of d.tractors.slice().sort((a, b) => (prefer === 'high' ? b.top - a.top : a.top - b.top))) {
      if (needT <= 0) break;
      const pairsToTake = Math.min(t.len, Math.max(2, needT));
      const slice = t.cards.slice(0, pairsToTake * 2);
      if (chosen.length + slice.length <= req.fromGroup) { take(slice); needT -= pairsToTake; }
    }
    let needP = Math.max(0, req.reqPairs - chosen.length / 2);
    for (const p of d.pairs.slice().sort((a, b) => (prefer === 'high' ? b.ord - a.ord : a.ord - b.ord))) {
      if (needP <= 0) break;
      if (p.cards.some((c) => used.has(c.id))) continue;
      if (chosen.length + 2 > req.fromGroup) break;
      take(p.cards); needP--;
    }
    const spare = own.filter((c) => !used.has(c.id))
      .sort((a, b) => (prefer === 'high' ? ctx.ordOf(b) - ctx.ordOf(a) : ctx.ordOf(a) - ctx.ordOf(b)));
    for (const c of spare) { if (chosen.length >= req.fromGroup) break; take([c]); }
  }
  const fillers = rest.slice().sort((a, b) => ctx.ordOf(a) - ctx.ordOf(b));
  for (const c of fillers) { if (chosen.length >= req.n) break; chosen.push(c); }
  return chosen.slice(0, req.n);
}

export { cardKey };
