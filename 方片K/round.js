// Used by both real settlement and bot forecasts; null is a timed-out choice.
function evaluateRound(players, stage) {
  const submitted = players.filter(p => p.value !== null);
  const sum = submitted.reduce((s, p) => s + p.value, 0);
  const n = submitted.length;
  const average = n ? sum / n : null;
  const target = n ? average * 0.8 : null;
  const counts = new Map();
  submitted.forEach(p => counts.set(p.value, (counts.get(p.value) || 0) + 1));
  const duplicated = stage >= 1 ? [...counts].filter(([, count]) => count > 1).map(([v]) => v) : [];
  const valid = submitted.filter(p => !duplicated.includes(p.value));
  const special = players.length === 2 && submitted.some(p => p.value === 0) && submitted.find(p => p.value === 100);
  const distance = p => Math.abs(p.value * 5 * n - sum * 4);
  const closest = Math.min(...valid.map(distance));
  const winners = special ? [special] : valid.filter(p => distance(p) === closest);
  const exactHit = stage >= 2 && winners.some(p => p.value === Math.round(target));
  const penalty = exactHit ? 2 : 1;
  const losses = players.map(p => ({ seat: p.seat, deduction: p.value === null ? 1 : winners.includes(p) ? 0 : penalty }));
  return { average, target, duplicated, winners, exactHit, penalty, specialRule: Boolean(special), losses };
}

module.exports = { evaluateRound };
