import * as THREE from 'three'

// A point on a building's footprint, in local metres: the middle of the largest triangle of its outline.
// Unlike the centre of the bounding box, it always lies on the building, even for L- or U-shaped ones.
const cache = new WeakMap()

export function buildingPoint(b) {
  if (cache.has(b)) return cache.get(b)
  const outer = b.rings[0].slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y))
  let best = [(b.bbox[0] + b.bbox[2]) / 2, (b.bbox[1] + b.bbox[3]) / 2]
  let bestA = -1
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(outer, [])) {
    const a = Math.abs(THREE.ShapeUtils.area([outer[i], outer[j], outer[k]]))
    if (a > bestA) {
      bestA = a
      best = [(outer[i].x + outer[j].x + outer[k].x) / 3, (outer[i].y + outer[j].y + outer[k].y) / 3]
    }
  }
  cache.set(b, best)
  return best
}
