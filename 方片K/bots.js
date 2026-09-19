const { evaluateRound } = require("./round");

const BOT_PROFILES = [
  { name: "砺石", style: "稳健", memory: 8, trend: .25, depth: .1, risk: 1.2 },
  { name: "逐流", style: "趋势", memory: 4, trend: .9, depth: .2, risk: .7 },
  { name: "算子", style: "推演", memory: 6, trend: .5, depth: .65, risk: .9 },
  { name: "逆锋", style: "反向", memory: 5, trend: -.4, depth: .35, risk: .4 }
];
const clamp = value => Math.max(0, Math.min(100, Math.round(value)));

// Input contains public scores and completed rounds only. No room, tokens,
// current submissions, other bots' plans or cross-game memory are accessible.
function chooseBotNumber({ seat, profile, players, history, stage }, random = Math.random) {
  const style = BOT_PROFILES[profile];
  const records = history.slice(-style.memory);
  const opponents = players.filter(p => p.seat !== seat);
  const models = opponents.map(opponent => {
    const series = records.map(r => ({ value: r.values.find(p => p.seat === opponent.seat)?.value, target: r.target }))
      .filter(r => Number.isInteger(r.value));
    if (!series.length) return { mean: 38 - style.depth * 12, spread: 18, series };
    // Compare persistence, trend-following and target-following predictions
    // against this opponent's actual previous choices, favouring recent rounds.
    const predict = (i, model) => {
      const last = series[i - 1];
      if (model === 0) return last.value;
      if (model === 1) return clamp(last.value + style.trend * (last.value - (series[i - 2]?.value ?? last.value)));
      return clamp((last.target ?? last.value) * (1 - .2 * style.depth));
    };
    const errors = [0, 1, 2].map(model => {
      let sum = 0, weight = 0;
      for (let i = 1; i < series.length; i++) { sum += i * Math.abs(series[i].value - predict(i, model)); weight += i; }
      return weight ? sum / weight : 8;
    });
    const weights = errors.map(error => 1 / (3 + error));
    const total = weights.reduce((a, b) => a + b, 0);
    const mean = weights.reduce((s, w, model) => s + w * predict(series.length, model), 0) / total;
    return { mean, spread: Math.max(2, Math.min(20, Math.min(...errors) + 3)), series };
  });
  const scores = Array(101).fill(0);
  const self = players.find(p => p.seat === seat);
  // Fixed work per turn. Every integer is evaluated against the same scenarios.
  for (let sample = 0; sample < 72; sample++) {
    const predicted = opponents.map((p, i) => {
      const model = models[i];
      // Empirical samples retain repeated values (especially 0/100 in a duel).
      const empirical = model.series.length && random() < .35;
      const value = empirical ? model.series[Math.floor(random() * model.series.length)].value
        : clamp(model.mean + (random() + random() + random() - 1.5) * model.spread);
      return { seat: p.seat, value };
    });
    for (let value = 0; value <= 100; value++) {
      const outcome = evaluateRound([{ seat, value }, ...predicted], stage);
      const ownLoss = outcome.losses[0].deduction;
      const winning = outcome.winners.some(p => p.seat === seat);
      const eliminated = self.score - ownLoss <= -10;
      const rivalsOut = opponents.filter(p => p.score - outcome.losses.find(loss => loss.seat === p.seat).deduction <= -10).length;
      scores[value] += -ownLoss + (winning ? .25 : 0) - (eliminated ? 1 + style.risk : 0) + rivalsOut * .15
        - .003 * Math.abs(value - outcome.target);
    }
  }
  const best = Math.max(...scores);
  // Variation is restricted to near-best choices, never a uniform 0..100 draw.
  const candidates = scores.map((score, value) => ({ score, value })).filter(p => p.score >= best - 2)
    .sort((a, b) => b.score - a.score).slice(0, 4);
  return candidates[Math.floor(random() * candidates.length)].value;
}

module.exports = { BOT_PROFILES, chooseBotNumber };
