// Finds which building a clicked triangle belongs to. `starts` are the first vertex of each
// building's run of vertices in a merged mesh, `owners` the building index of each run.
export function ownerLookup(starts, owners) {
  const order = starts.map((s, i) => i).sort((a, b) => starts[a] - starts[b])
  const s = order.map((i) => starts[i])
  const o = order.map((i) => owners[i])
  return (vertex) => {
    let lo = 0
    let hi = s.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (s[mid] <= vertex) lo = mid
      else hi = mid - 1
    }
    return o[lo]
  }
}
