const { evaluateRound } = require("./round");

const BOT_PROFILES = [
  { name: "砺石", style: "直觉", depth: 1, memory: 12, prior: 50, risk: 2, collision: .12, pressure: .04, weights: [3,1,1,1,1] },
  { name: "逐流", style: "推理", depth: 2, memory: 8, prior: 50, risk: 1, collision: .08, pressure: .08, weights: [1,2,3,1,1] },
  { name: "算子", style: "深算", depth: 3, memory: 12, prior: 50, risk: 1.5, collision: .16, pressure: .1, weights: [1,1,1,3,2] },
  { name: "逆锋", style: "适应", depth: null, memory: 10, prior: 50, risk: .6, collision: .4, pressure: .16, weights: [1,1,1,2,3] }
];
const clamp = value => Math.max(0, Math.min(100, Math.round(value)));
const median = values => { const sorted = [...values].sort((a,b) => a-b); return sorted[Math.floor(sorted.length / 2)]; };

// Level 1 responds to observed behaviour. Higher levels additionally imagine
// simultaneous opponent responses; the final decision always uses actual rules.
function projectResponses(values, depth) {
  let projected = values;
  for (let level=1;level<depth;level++) {
    const sum=projected.reduce((s,p)=>s+p.value,0);
    projected=projected.map(p=>({...p,value:clamp(.8*(sum-p.value)/(projected.length-.8))}));
  }
  return projected;
}
function reasoningDepth(style, records, players) {
  if (style.depth!==null) return style.depth;
  // Backtest depths against subsequent public choices, without current inputs.
  const errors=[0,0,0], weights=[0,0,0];
  for(let i=1;i<records.length;i++) {
    const previous=records[i-1].values.filter(p=>Number.isInteger(p.value) && players.some(a=>a.seat===p.seat));
    if(previous.length!==players.length) continue;
    for(let depth=1;depth<=3;depth++) {
      const predicted=projectResponses(previous,depth);
      for(const p of predicted) {
        const actual=records[i].values.find(a=>a.seat===p.seat)?.value;
        if(Number.isInteger(actual)){errors[depth-1]+=i*Math.abs(p.value-actual);weights[depth-1]+=i;}
      }
    }
  }
  const losses=errors.map((e,i)=>weights[i]?e/weights[i]:Infinity);
  return losses.every(v=>v===Infinity) ? 2 : losses.indexOf(Math.min(...losses))+1;
}

// Input contains public scores and completed rounds only. No room, tokens,
// current submissions, other bots' plans or cross-game memory are accessible.
function chooseBotNumber({ seat, profile, players, history, stage }, random = Math.random) {
  const style = BOT_PROFILES[profile];
  const records = history.slice(-style.memory);
  const depth = players.length === 2 ? 1 : reasoningDepth(style, records, players);
  const opponents = players.filter(p => p.seat !== seat);
  const models = opponents.map(opponent => {
    // Keep missing rounds in place: a timeout must not become an alternating turn.
    const series = records.map(r => r.values.find(p => p.seat === opponent.seat)?.value ?? null);
    if (!series.some(Number.isInteger)) return { forecasts: [{value: style.prior, weight: 1, error: 16}], total: 1, noise: 1 };
    // Forecast each seat separately. Test each hypothesis on earlier rounds,
    // rather than treating the previous table target as everybody's next choice.
    const predict = (i, model) => {
      const observed = series.slice(0, i).filter(Number.isInteger);
      if (!observed.length) return style.prior;
      const last = observed.at(-1);
      const center = median(observed.slice(-5));
      if (model === 0) return center;
      if (model === 1) return last;
      if (model === 2) return clamp(last + Math.max(-15, Math.min(15, last - (observed.at(-2) ?? last))));
      if (model === 3) return series[i - 2] ?? center;
      // Find past responses to a similar public table target.
      const target = records[i - 1]?.target;
      if (target === null || target === undefined) return center;
      const matches = [];
      for (let j = 1; j < i; j++) if (Number.isInteger(series[j]) && records[j - 1].target !== null) {
        matches.push({ distance: Math.abs(records[j - 1].target - target), value: series[j] });
      }
      matches.sort((a,b) => a.distance-b.distance);
      return matches.length ? median(matches.slice(0,3).map(p=>p.value)) : center;
    };
    const observed = series.filter(Number.isInteger);
    const previous = observed.slice(0,-1);
    const center = previous.length ? median(previous) : observed[0];
    const deviation = previous.length ? median(previous.map(v=>Math.abs(v-center))) : 0;
    const isolatedJump = previous.length >= 3 && Math.abs(observed.at(-1)-center) > Math.max(20, deviation * 3);
    const forecasts = style.weights.map((prior, model) => {
      let sum = 0, weight = 0;
      for (let i = 1; i < series.length; i++) if (Number.isInteger(series[i])) {
        const w = i + 1;
        sum += w * Math.abs(series[i] - predict(i, model)); weight += w;
      }
      const error = weight ? sum / weight : 8;
      // One shock is weak evidence of a permanent switch. Repeated high choices
      // move the median and restore support without a special human-player rule.
      const shockDiscount = isolatedJump && (model === 1 || model === 2) ? .08 : 1;
      return { value: predict(series.length,model), error, weight: prior * shockDiscount / (2 + error) ** 2 };
    });
    return { forecasts, total: forecasts.reduce((sum,p)=>sum+p.weight,0), noise: .2, patterned: (isolatedJump && deviation<=1) || series.length>=4 && series.slice(-4).every(Number.isInteger) && series.at(-1)===series.at(-3) && series.at(-2)===series.at(-4) };
  });
  const scores = Array(101).fill(0);
  const self = players.find(p => p.seat === seat);
  // Fixed work per turn. Every integer is evaluated against the same scenarios.
  for (let sample = 0; sample < 72; sample++) {
    let predicted = opponents.map((p, i) => {
      const model = models[i];
      let pick = random() * model.total;
      const forecast = model.forecasts.find(f => (pick -= f.weight) <= 0) || model.forecasts.at(-1);
      // Exact hypotheses retain collision probability and 0/100 counterplay.
      // Averaging incompatible modes would invent numbers the opponent never uses.
      const value = random() < model.noise
        ? clamp(forecast.value + (random() + random() + random() - 1.5) * Math.max(2, Math.min(20, forecast.error)))
        : forecast.value;
      return { seat: p.seat, value };
    });

    if(depth>1 && !(records.length>=4 && models.every(m=>m.patterned || Math.min(...m.forecasts.map(f=>f.error))<=1))) {
      const ownObserved=records.at(-1)?.values.find(p=>p.seat===seat)?.value;
      const assumedSelf=Number.isInteger(ownObserved)?ownObserved:style.prior;
      predicted=projectResponses([{seat,value:assumedSelf},...predicted],depth).filter(p=>p.seat!==seat);
    }
    for (let value = 0; value <= 100; value++) {
      const outcome = evaluateRound([{ seat, value }, ...predicted], stage);
      const ownLoss = outcome.losses[0].deduction;
      const winning = outcome.winners.some(p => p.seat === seat);
      const eliminated = self.score - ownLoss <= -10;
      const rivalsOut = opponents.filter(p => p.score - outcome.losses.find(loss => loss.seat === p.seat).deduction <= -10).length;
      const leader = Math.max(...players.map(p=>p.score));
      const leaderLoss = opponents.filter(p=>p.score===leader).reduce((sum,p)=>sum+outcome.losses.find(loss=>loss.seat===p.seat).deduction,0);
      const collision = stage >= 1 && predicted.some(p=>p.value===value);
      scores[value] += -ownLoss + (winning ? .25 : 0) - (eliminated ? 1 + style.risk : 0) + rivalsOut * .15
        + (self.score > -8 ? style.pressure * leaderLoss : 0) - (collision ? style.collision : 0)
        - .001 * Math.abs(value - outcome.target);
    }
  }
  const best = Math.max(...scores);
  // Variation is restricted to near-best choices, never a uniform 0..100 draw.
  const candidates = scores.map((score, value) => ({ score, value })).filter(p => p.score >= best - 2)
    .sort((a, b) => b.score - a.score).slice(0, 4);
  return candidates[Math.floor(random() * candidates.length)].value;
}

module.exports = { BOT_PROFILES, chooseBotNumber };
