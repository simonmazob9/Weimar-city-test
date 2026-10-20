import polygonClipping from 'polygon-clipping'

// All calculations run in a flat local system in metres: x to the east, y to the north,
// with the origin at the centre of the kit. Over 2 km the error of this projection is far below 1 m.

export const WALK_M_PER_MIN = 80 // 4.8 km/h
export const MINUTES = [5, 10, 15]
export const BAND_M = 25 // band on each side of a reached street
export const MAX_SNAP_M = 100 // a click further than this from the network finds no start

const R = 6371008.8

export function makeProjection([lon0, lat0]) {
  const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180)
  const ky = (Math.PI / 180) * R
  return ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]
}

// ---------- network ----------

export function buildNetwork(graph, project) {
  const nodes = new Map()
  for (const n of graph.nodes) nodes.set(n.id, { id: n.id, xy: project([n.lon, n.lat]), adj: [] })
  const edges = []
  for (const e of graph.edges) {
    if (!e.walkable) continue
    const pts = e.coords.map(project)
    const edge = { id: e.id, from: e.from, to: e.to, length: e.length, pts }
    edges.push(edge)
    nodes.get(e.from).adj.push(edge)
    nodes.get(e.to).adj.push(edge)
  }
  // only nodes that lie on a walkable edge can be a start
  const walkableNodes = [...nodes.values()].filter((n) => n.adj.length > 0)
  return { nodes, edges, walkableNodes }
}

export function nearestNode(net, [x, y]) {
  let best = null
  let bestD = Infinity
  for (const n of net.walkableNodes) {
    const d = Math.hypot(n.xy[0] - x, n.xy[1] - y)
    if (d < bestD) {
      bestD = d
      best = n
    }
  }
  return { node: best, distance: bestD }
}

// Shortest walking distance in metres from the start node to every node (Dijkstra).
// If `prev` is given, it records for each node the edge it was reached by, to trace a route back.
export function walkDistances(net, startId, maxM, prev = null) {
  const dist = new Map([[startId, 0]])
  const heap = [[0, startId]]
  const push = (item) => {
    heap.push(item)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  while (heap.length) {
    const [d, id] = pop()
    if (d > dist.get(id) || d > maxM) continue
    for (const e of net.nodes.get(id).adj) {
      const other = e.from === id ? e.to : e.from
      const nd = d + e.length
      if (nd < (dist.get(other) ?? Infinity)) {
        dist.set(other, nd)
        if (prev) prev.set(other, e)
        push([nd, other])
      }
    }
  }
  return dist
}

// The part of a polyline between distance a and b from its start, measured with the edge's
// own `length` (the drawn line is scaled to it).
function subLine(pts, length, a, b) {
  const seg = []
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    seg.push(l)
    total += l
  }
  const scale = total > 0 ? total / length : 0
  const A = a * scale
  const B = b * scale
  const out = []
  let s = 0
  const at = (i, t) => [
    pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
    pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
  ]
  for (let i = 1; i < pts.length; i++) {
    const l = seg[i - 1]
    const s0 = s
    const s1 = s + l
    s = s1
    if (s1 < A || s0 > B || l === 0) continue
    const t0 = Math.max(0, (A - s0) / l)
    const t1 = Math.min(1, (B - s0) / l)
    if (!out.length) out.push(at(i, t0))
    out.push(at(i, t1))
  }
  if (out.length === 1) out.push(out[0])
  return out
}

// Street pieces reached within maxM metres: whole edges, and the reachable part of the last ones.
export function reachedLines(net, dist, maxM) {
  const lines = []
  for (const e of net.edges) {
    const da = dist.get(e.from) ?? Infinity
    const db = dist.get(e.to) ?? Infinity
    const ra = Math.max(0, Math.min(e.length, maxM - da)) // reached from the `from` end
    const rb = Math.max(0, Math.min(e.length, maxM - db)) // reached from the `to` end
    if (da > maxM && db > maxM) continue
    if (ra + rb >= e.length) {
      lines.push(e.pts)
    } else {
      if (da <= maxM) lines.push(subLine(e.pts, e.length, 0, ra))
      if (db <= maxM) lines.push(subLine(e.pts, e.length, e.length - rb, e.length))
    }
  }
  return lines
}

// ---------- the band of 25 m around the reached streets ----------

const CAP_STEPS = 12 // points per half circle at the ends of each piece

// A "capsule": the area within r of one straight segment.
function capsule([x1, y1], [x2, y2], r) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  const ring = []
  if (len < 1e-6) {
    for (let i = 0; i < CAP_STEPS * 2; i++) {
      const a = (i / (CAP_STEPS * 2)) * Math.PI * 2
      ring.push([x1 + r * Math.cos(a), y1 + r * Math.sin(a)])
    }
  } else {
    const base = Math.atan2(dy, dx)
    for (let i = 0; i <= CAP_STEPS; i++) {
      const a = base - Math.PI / 2 + (i / CAP_STEPS) * Math.PI
      ring.push([x2 + r * Math.cos(a), y2 + r * Math.sin(a)])
    }
    for (let i = 0; i <= CAP_STEPS; i++) {
      const a = base + Math.PI / 2 + (i / CAP_STEPS) * Math.PI
      ring.push([x1 + r * Math.cos(a), y1 + r * Math.sin(a)])
    }
  }
  ring.push(ring[0])
  return [ring]
}

// polygon-clipping sometimes fails on nearly touching edges ("Unable to complete output ring").
// Then the same operation is tried again with all points rounded to 1 cm, 5 cm or 20 cm,
// which moves the shapes far less than anything you can see or count.
const roundShape = (g, step) =>
  Array.isArray(g[0]) ? g.map((x) => roundShape(x, step)) : [Math.round(g[0] / step) * step, Math.round(g[1] / step) * step]

function clip(op, ...shapes) {
  try {
    return polygonClipping[op](...shapes)
  } catch (err) {
    for (const step of [0.01, 0.05, 0.2]) {
      try {
        return polygonClipping[op](...shapes.map((g) => roundShape(g, step)))
      } catch {
        // try the next, coarser step
      }
    }
    throw err
  }
}

function unionAll(polys) {
  // merge in a balanced tree: much faster than adding one piece at a time
  let layer = polys.map((p) => [p])
  if (!layer.length) return []
  while (layer.length > 1) {
    const next = []
    for (let i = 0; i < layer.length; i += 8) {
      const group = layer.slice(i, i + 8)
      next.push(group.length === 1 ? group[0] : clip('union', ...group))
    }
    layer = next
  }
  return layer[0] // MultiPolygon: [polygon][ring][point]
}

// One capsule per straight piece of reached street, with its bounding box.
export function bandCapsules(lines, r) {
  const caps = []
  for (const line of lines)
    for (let i = 1; i < line.length; i++) {
      const [a, b] = [line[i - 1], line[i]]
      caps.push({
        poly: capsule(a, b, r),
        bbox: [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r],
      })
    }
  return caps
}

// The capsules joined into one shape.
export function bandShape(caps) {
  return unionAll(caps.map((c) => c.poly))
}

// ---------- areas ----------

function ringArea(ring) {
  let a = 0
  for (let i = 1; i < ring.length; i++) a += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1]
  return a / 2
}

export function multiPolygonArea(mp) {
  let a = 0
  for (const poly of mp) poly.forEach((ring, i) => (a += (i === 0 ? 1 : -1) * Math.abs(ringArea(ring))))
  return a
}

// ---------- buildings that touch an area ----------

function segSegDist2(p, q, a, b) {
  // squared distance between segments pq and ab (0 if they cross)
  const cross = (o, u, v) => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0])
  const d1 = cross(a, b, p)
  const d2 = cross(a, b, q)
  const d3 = cross(p, q, a)
  const d4 = cross(p, q, b)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(ptSegDist2(p, a, b), ptSegDist2(q, a, b), ptSegDist2(a, p, q), ptSegDist2(b, p, q))
}

function ptSegDist2([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  const ex = ax + t * dx - px
  const ey = ay + t * dy - py
  return ex * ex + ey * ey
}

function pointInRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// A building touches the band if some reached street piece comes within 25 m of its footprint,
// or runs inside it. That is the same as the footprint overlapping the band.
export function touchedBuildings(buildings, lines, r) {
  const r2 = r * r
  const segs = []
  for (const line of lines) for (let i = 1; i < line.length; i++) segs.push([line[i - 1], line[i]])
  // a coarse grid of segments, so each building only checks the streets near it
  const CELL = 50
  const grid = new Map()
  for (const s of segs) {
    const x0 = Math.floor((Math.min(s[0][0], s[1][0]) - r) / CELL)
    const x1 = Math.floor((Math.max(s[0][0], s[1][0]) + r) / CELL)
    const y0 = Math.floor((Math.min(s[0][1], s[1][1]) - r) / CELL)
    const y1 = Math.floor((Math.max(s[0][1], s[1][1]) + r) / CELL)
    for (let gx = x0; gx <= x1; gx++)
      for (let gy = y0; gy <= y1; gy++) {
        const k = gx + ',' + gy
        if (!grid.has(k)) grid.set(k, [])
        grid.get(k).push(s)
      }
  }
  const hit = new Set()
  for (const b of buildings) {
    const [minX, minY, maxX, maxY] = b.bbox
    const near = new Set()
    for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++)
      for (let gy = Math.floor(minY / CELL); gy <= Math.floor(maxY / CELL); gy++)
        for (const s of grid.get(gx + ',' + gy) ?? []) near.add(s)
    let touches = false
    for (const s of near) {
      if (pointInRing(s[0], b.rings[0]) && !b.rings.slice(1).some((h) => pointInRing(s[0], h))) touches = true
      else
        for (const ring of b.rings) {
          for (let i = 1; i < ring.length && !touches; i++)
            if (segSegDist2(s[0], s[1], ring[i - 1], ring[i]) <= r2) touches = true
          if (touches) break
        }
      if (touches) break
    }
    if (touches) hit.add(b.index)
  }
  return hit
}

// ---------- residents ----------

// Each cell is cut against only the capsules that reach into it; the result is the same as
// cutting it out of the whole band, and much faster.
export function residents(cells, caps) {
  let sum = 0
  let unknownCells = 0
  for (const c of cells) {
    const [minX, minY, maxX, maxY] = c.bbox
    const near = caps.filter(({ bbox: b }) => b[0] < maxX && b[2] > minX && b[1] < maxY && b[3] > minY)
    if (!near.length) continue
    const inside = multiPolygonArea(clip('intersection', [c.ring], unionAll(near.map((n) => n.poly))))
    if (inside <= 0.01) continue // touches only along an edge
    if (c.population == null) unknownCells++
    else sum += c.population * (inside / c.area)
  }
  return { residents: Math.round(sum / 10) * 10, exact: sum, unknownCells }
}

// ---------- everything for one click ----------

export function computeReach({ net, buildings, cells }, startNode) {
  const maxM = MINUTES[MINUTES.length - 1] * WALK_M_PER_MIN
  const dist = walkDistances(net, startNode.id, maxM)
  return MINUTES.map((min) => {
    const m = min * WALK_M_PER_MIN
    const lines = reachedLines(net, dist, m)
    const caps = bandCapsules(lines, BAND_M)
    const shape = bandShape(caps)
    const buildingIds = touchedBuildings(buildings, lines, BAND_M)
    return { minutes: min, metres: m, lines, shape, buildings: buildingIds, ...residents(cells, caps) }
  })
}

// ---------- routes ----------

// The whole network from one start node: distances and the edge each node was reached by.
export function shortestTree(net, startId) {
  const prev = new Map()
  const dist = walkDistances(net, startId, Infinity, prev)
  return { startId, dist, prev }
}

// The shortest walking route from the tree's start node to the walkable node nearest `point`.
// If no walkable node is within 100 m of the point, says so with `tooFar`.
export function routeTo(net, tree, point) {
  const { node: end, distance: snap } = nearestNode(net, point)
  if (snap > MAX_SNAP_M) return { tooFar: true, snap }
  const length = tree.dist.get(end.id)
  if (length == null) return { unreachable: true, snap }
  // walk back from the end to the start, then turn the list around
  const legs = []
  let id = end.id
  while (id !== tree.startId) {
    const e = tree.prev.get(id)
    const from = e.from === id ? e.to : e.from
    legs.push(e.from === from ? e.pts : [...e.pts].reverse()) // each leg drawn in walking direction
    id = from
  }
  legs.reverse()
  const line = [net.nodes.get(tree.startId).xy]
  for (const leg of legs) line.push(...leg.slice(1))
  return { line, length, snap, end: end.xy }
}

// ---------- preparing the kit ----------

export function prepareBuildings(geojson, project) {
  return geojson.features.map((f, index) => {
    const rings = f.geometry.coordinates.map((ring) => ring.map(project))
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of rings[0]) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
    }
    // every use with floor area in the building, not only the largest one
    const uses = Object.entries(f.properties.floor_area_m2 ?? {}).filter(([, a]) => a > 0).map(([u]) => u)
    return { index, id: f.properties.id, height: f.properties.height, use: f.properties.use ?? 'undefined', uses, rings, bbox: [minX, minY, maxX, maxY] }
  })
}

export function prepareCells(geojson, project) {
  return geojson.features.map((f) => {
    const ring = f.geometry.coordinates[0].map(project)
    const xs = ring.map((p) => p[0])
    const ys = ring.map((p) => p[1])
    return {
      id: f.properties.id,
      population: f.properties.population,
      ring,
      area: Math.abs(ringArea(ring)),
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    }
  })
}
