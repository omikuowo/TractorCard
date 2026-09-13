import { TractorGame, DEFAULT_OPTIONS, TEAM } from '../src/game.js';
import { aiDeclare, aiBury, aiPlay } from '../src/ai.js';
import { pointsOf } from '../src/cards.js';

function playHand(g) {
  g.newHand();
  while (!g.dealingDone) {
    g.dealStep();
    for (let s = 0; s < 4; s++) {
      const o = aiDeclare(g, s);
      if (o) g.declare(s, o);
    }
  }
  g.closeDeal();
  const r = g.bury(g.dealerSeat, aiBury(g, g.dealerSeat));
  if (!r.ok) throw new Error('bury failed: ' + r.reason);
  let guard = 0;
  while (g.phase === 'playing') {
    if (++guard > 400) throw new Error('stuck at trick ' + g.tricks.length);
    const seat = g.turnSeat;
    let cards = aiPlay(g, seat);
    let res = g.play(seat, cards);
    if (!res.ok) {
      if (res.forced) res = g.play(seat, res.forced);
      if (!res.ok) throw new Error(`illegal seat${seat}: ${res.reason} | ${cards.map(c=>c.suit+c.rank).join(',')}`);
    }
  }
  return g.result;
}

const N = Number(process.argv[2] || 200);
let hands = 0, matches = 0, errs = 0;
const tally = {};
for (let m = 0; m < N; m++) {
  const g = new TractorGame({ ...DEFAULT_OPTIONS, difficulty: 2, constTwo: m % 3 === 0 });
  let h = 0;
  try {
    while (h < 60) {
      const r = playHand(g); hands++; h++;
      tally[r.desc] = (tally[r.desc] || 0) + 1;
      // 点数守恒检查：闲家分 + 庄家分 + 底牌分 = 200
      const dealerPts = g.tricks.filter(t => TEAM(t.winner) === TEAM(g.dealerSeat)).reduce((s,t)=>s+t.points,0);
      const raw = r.defenderPoints - r.kittyBonus;
      if (raw + dealerPts + r.kittyPoints !== 200) throw new Error(`点数不守恒 ${raw}+${dealerPts}+${r.kittyPoints}`);
      if (r.matchOver) { matches++; break; }
      g.advanceHand();
    }
  } catch (e) { errs++; console.error('ERR', e.message); if (errs > 3) break; }
}
console.log(`牌局 ${hands} 副，完成 ${matches} 整局，错误 ${errs}`);
console.log(tally);
