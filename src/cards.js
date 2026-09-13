/*!
 * 拖拉机大赛 Web (TractorCard)
 * Copyright (c) 2026 TractorCard Project. All rights reserved. 版权所有，保留一切权利。
 * 未经著作权人事先书面授权，不得使用、复制、修改、分发本软件或其任何部分。
 * Unauthorized use, copying, modification or distribution is strictly prohibited.
 */

/** 四门花色，按界面固定顺序排列。 */
export const SUITS = ['spades', 'hearts', 'clubs', 'diamonds'];
export const SUIT_CN = { spades: '黑桃', hearts: '红桃', clubs: '梅花', diamonds: '方块', joker: '王' };
export const SUIT_SYM = { spades: '♠', hearts: '♥', clubs: '♣', diamonds: '♦', joker: '王' };
export const RED_SUITS = new Set(['hearts', 'diamonds']);

/** 牌面点数，由小到大。2 最小，A 最大。 */
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const RANK_CN = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  '10': '10', J: 'J', Q: 'Q', K: 'K', A: 'A', small: '小王', big: '大王',
};

/** 可以作为“级牌”的点数（2 起打，A 为最高级）。 */
export const LEVELS = RANKS.slice();

/** 分值牌：5 计 5 分，10 与 K 各计 10 分。一副 108 张共 200 分。 */
export function cardPoints(card) {
  if (card.rank === '5') return 5;
  if (card.rank === '10' || card.rank === 'K') return 10;
  return 0;
}

export function pointsOf(cards) {
  let sum = 0;
  for (const c of cards) sum += cardPoints(c);
  return sum;
}

/** 生成两副共 108 张牌（含四张王）。 */
export function buildDeck() {
  const deck = [];
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) deck.push(makeCard(suit, rank, copy));
    }
    deck.push(makeCard('joker', 'small', copy));
    deck.push(makeCard('joker', 'big', copy));
  }
  return deck;
}

function makeCard(suit, rank, copy) {
  return { id: `${suit}-${rank}-${copy}`, suit, rank, copy };
}

/** 图片资源名（与 assets/cards 下的文件同名）。 */
export function cardImage(card) {
  if (card.suit === 'joker') return card.rank === 'big' ? 'joker-big' : 'joker-small';
  return `${card.suit}-${card.rank}`;
}

export function cardLabel(card) {
  if (card.suit === 'joker') return RANK_CN[card.rank];
  return SUIT_SYM[card.suit] + card.rank;
}

/** Fisher–Yates 洗牌，接受外部随机源以便复现牌局。 */
export function shuffle(cards, rng = Math.random) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
