// Kenning map layout (spec section 3). Pure and deterministic: the same stations always give the same picture.
// Every mark is something the person said or confirmed; nothing here derives size, direction or conflict.
export const LINE_ORDER = ["family", "relationships", "work", "money", "meaning", "body", "politics", "morality", "me"] as const;
export const MAX_LINES = 6, MAX_STATIONS = 5, LINE_GAP = 88, STATION_GAP = 96, X0 = 48, LINE_WIDTH = 7;

export interface Station {
  id: string; lines: string[]; order: Record<string, number>; level: string | null; created_at: string;
}
export interface Placed { id: string; line: string; x: number; y: number; interchange: boolean }
export interface LineOut {
  topic: string; y: number; station_ids: string[]; overflow_ids: string[]; // overflow opens from a tap on the line's end; no count is sent as a number
  path: Array<[number, number]>; // horizontal and 45-degree segments only
}
export interface Layout { lines: LineOut[]; more_lines: string[]; stations: Placed[]; axis: { left: "broad"; right: "specific" } }

const lvl = (l: string | null) => l ? Number(l.slice(1)) : 9; // L0 broadest ... L4 most specific (assumed; asked in QUESTIONS)

/** Position of a station on a line: the person's stored order wins, then the engine's level, then date, then id. */
function cmp(line: string) {
  return (a: Station, b: Station) => {
    const oa = a.order[line], ob = b.order[line];
    if (oa !== undefined && ob !== undefined && oa !== ob) return oa - ob;
    if ((oa !== undefined) !== (ob !== undefined)) return oa !== undefined ? -1 : 1;
    return lvl(a.level) - lvl(b.level) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  };
}

export function layoutKennings(input: Station[]): Layout {
  const byLine = new Map<string, Station[]>();
  for (const s of input) for (const l of s.lines.slice(0, 2)) byLine.set(l, [...(byLine.get(l) ?? []), s]);
  const rank = (l: string) => LINE_ORDER.indexOf(l as never) < 0 ? 99 : LINE_ORDER.indexOf(l as never);
  // 1. Lines: the most stations first (ties by fixed topic order); at most 6 on screen.
  const ranked = [...byLine.keys()].sort((a, b) => byLine.get(b)!.length - byLine.get(a)!.length || rank(a) - rank(b));
  const shown = ranked.slice(0, MAX_LINES), more = ranked.slice(MAX_LINES).sort((a, b) => rank(a) - rank(b));
  // 2. Line order: barycenter on shared interchanges so linked lines are neighbours; a few stable passes.
  let order = [...shown].sort((a, b) => rank(a) - rank(b));
  for (let pass = 0; pass < 4; pass++) {
    const pos = new Map(order.map((l, i) => [l, i]));
    const bary = new Map(order.map((l) => {
      const peers = byLine.get(l)!.flatMap((s) => s.lines.filter((o) => o !== l && pos.has(o)).map((o) => pos.get(o)!));
      return [l, peers.length ? peers.reduce((x, y) => x + y, 0) / peers.length : pos.get(l)!] as const;
    }));
    const next = [...order].sort((a, b) => bary.get(a)! - bary.get(b)! || pos.get(a)! - pos.get(b)!);
    if (next.join() === order.join()) break;
    order = next;
  }
  const lineIdx = new Map(order.map((l, i) => [l, i]));
  // 3. Stations: stored order, at most 5 per line; the rest are overflow.
  const visible = new Map<string, Station[]>(), overflow = new Map<string, string[]>();
  for (const l of order) {
    const all = [...byLine.get(l)!].sort(cmp(l));
    visible.set(l, all.slice(0, MAX_STATIONS)); overflow.set(l, all.slice(MAX_STATIONS).map((s) => s.id));
  }
  // 4. Place stations line by line in sequence. A station on two adjacent shown lines (both visible) is an interchange when it
  // is next in line on BOTH lines; otherwise it sits on its upper line only (it still lists both lines). The lower line waits
  // for the upper line's decision, so the result never depends on input order.
  const placed = new Map<string, Placed>(), lastX = new Map<string, number>();
  const queue = new Map<string, Station[]>(order.map((l) => [l, [...visible.get(l)!]]));
  const lower = new Map<string, string>(), upper = new Map<string, string>(); // station -> its lower / upper line
  for (const s of input) {
    const ls = s.lines.slice(0, 2).filter((l) => lineIdx.has(l)).sort((a, b) => lineIdx.get(a)! - lineIdx.get(b)!);
    if (ls.length === 2 && lineIdx.get(ls[1])! - lineIdx.get(ls[0])! === 1 && visible.get(ls[0])!.includes(s) && visible.get(ls[1])!.includes(s)) {
      upper.set(s.id, ls[0]); lower.set(s.id, ls[1]);
    }
  }
  const put = (s: Station, line: string, lines: string[], inter: boolean) => {
    const x = Math.max(X0, ...lines.map((l) => lastX.has(l) ? lastX.get(l)! + STATION_GAP : X0));
    for (const l of lines) lastX.set(l, x);
    const y = inter ? (lineIdx.get(lines[0])! + 0.5) * LINE_GAP : lineIdx.get(line)! * LINE_GAP;
    placed.set(s.id, { id: s.id, line, x, y, interchange: inter });
  };
  for (let guard = 0; guard < 10000; guard++) {
    // The next ready head: smallest (rank on its line, line index).
    let pick: { line: string; r: number } | null = null;
    for (const l of order) {
      const q = queue.get(l)!;
      if (!q.length) continue;
      const head = q[0], r = visible.get(l)!.indexOf(head);
      const isLower = lower.get(head.id) === l;
      if (isLower && !placed.has(head.id)) continue; // waits for the upper line's decision
      if (!pick || r < pick.r) pick = { line: l, r };
    }
    if (!pick) break;
    const q = queue.get(pick.line)!, s = q[0];
    if (placed.has(s.id)) { q.shift(); continue; }      // already placed through its upper line, or dropped to it
    if (upper.get(s.id) === pick.line) {
      const lo = lower.get(s.id)!, lq = queue.get(lo)!;
      if (lq[0] === s) { put(s, pick.line, [pick.line, lo], true); lq.shift(); }
      else put(s, pick.line, [pick.line], false);
    } else put(s, pick.line, [pick.line], false);
    q.shift();
  }
  const linesOut: LineOut[] = order.map((l) => {
    const y = lineIdx.get(l)! * LINE_GAP, path: Array<[number, number]> = [[0, y]];
    const ids: string[] = [];
    for (const s of visible.get(l)!) {
      const p = placed.get(s.id);
      if (!p) continue;
      const onThis = p.line === l || (p.interchange && lower.get(s.id) === l);
      if (!onThis) continue;
      ids.push(s.id);
      if (p.interchange) {
        const d = Math.abs(p.y - y);
        path.push([p.x - d, y], [p.x, p.y], [p.x + d, y]);
      } else path.push([p.x, y]);
    }
    path.push([(path[path.length - 1][0]) + STATION_GAP / 2, y]);
    return { topic: l, y, station_ids: ids, overflow_ids: overflow.get(l)!, path };
  });
  return { lines: linesOut, more_lines: more, stations: [...placed.values()].sort((a, b) => a.id.localeCompare(b.id)), axis: { left: "broad", right: "specific" } };
}
