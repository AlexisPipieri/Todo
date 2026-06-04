'use strict';

function toLocalISO(d) {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Returns up to 6 date suggestions matching raw (the text after "@").
// Accepts an optional `now` date so callers can test against a fixed reference point.
function parseAtQuery(raw, now = new Date()) {
  const q = raw.toLowerCase().trim();
  if (!q) return [];

  const today = new Date(now); today.setHours(0, 0, 0, 0);

  function nextDow(dayIdx) {
    const d = new Date(today);
    const diff = (dayIdx - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function fmtSub(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const seen = new Set();
  const results = [];

  function add(label, d) {
    const iso = toLocalISO(d);
    if (!seen.has(iso)) { seen.add(iso); results.push({ label, sublabel: fmtSub(d), iso }); }
  }

  const tom = new Date(today); tom.setDate(tom.getDate() + 1);
  if ('today'.startsWith(q))    add('Today',    today);
  if ('tomorrow'.startsWith(q)) add('Tomorrow', tom);

  const DAYS = [
    ['sunday',    0, ['su', 'sun']],
    ['monday',    1, ['mo', 'mon']],
    ['tuesday',   2, ['tu', 'tue']],
    ['wednesday', 3, ['we', 'wed']],
    ['thursday',  4, ['th', 'thu']],
    ['friday',    5, ['fr', 'fri']],
    ['saturday',  6, ['sa', 'sat']],
  ];

  DAYS.forEach(([name, idx, aliases]) => {
    if (name.startsWith(q) || aliases.includes(q)) {
      add(name[0].toUpperCase() + name.slice(1), nextDow(idx));
    }
  });

  if (q.length >= 2 && 'next'.startsWith(q)) {
    add('Next Sunday', nextDow(0));
  }
  if (q.startsWith('next ')) {
    const rest = q.slice(5);
    DAYS.forEach(([name, idx, aliases]) => {
      if (!rest || name.startsWith(rest) || aliases.some(a => a === rest)) {
        const d = nextDow(idx); d.setDate(d.getDate() + 7);
        add('Next ' + name[0].toUpperCase() + name.slice(1), d);
      }
    });
  }

  const inMatch = q.match(/^in\s+(\d+)(?:\s+days?)?$/);
  if (inMatch) {
    const n = parseInt(inMatch[1], 10);
    if (n > 0 && n <= 365) {
      const d = new Date(today); d.setDate(d.getDate() + n);
      add(`In ${n} day${n !== 1 ? 's' : ''}`, d);
    }
  }

  const MONTHS = [
    ['january',   ['jan'], 0],  ['february',  ['feb'], 1],
    ['march',     ['mar'], 2],  ['april',     ['apr'], 3],
    ['may',       ['may'], 4],  ['june',      ['jun'], 5],
    ['july',      ['jul'], 6],  ['august',    ['aug'], 7],
    ['september', ['sep', 'sept'], 8], ['october', ['oct'], 9],
    ['november',  ['nov'], 10], ['december',  ['dec'], 11],
  ];

  const mParts = q.match(/^([a-z]+)(?:\s+(\d{1,2}))?$/);
  if (mParts) {
    const mq = mParts[1], dq = mParts[2] ? parseInt(mParts[2], 10) : null;
    MONTHS.forEach(([fullName, abbrs, idx]) => {
      if (fullName.startsWith(mq) || abbrs.some(a => a.startsWith(mq))) {
        const dayNum = (dq && dq >= 1 && dq <= 31) ? dq : null;
        let year = today.getFullYear();
        const d = new Date(year, idx, dayNum || 1);
        if (d <= today) d.setFullYear(year + 1);
        const mLabel = fullName[0].toUpperCase() + fullName.slice(1, 3);
        add(dayNum ? `${mLabel} ${dayNum}` : mLabel, d);
      }
    });
  }

  return results.slice(0, 6);
}

module.exports = { toLocalISO, parseAtQuery };
