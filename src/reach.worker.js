// Runs the reach and route calculations in the background, so the 3D view stays smooth while it works.
import {
  makeProjection,
  buildNetwork,
  prepareBuildings,
  prepareCells,
  nearestNode,
  computeReach,
  shortestTree,
  routeTo,
  MAX_SNAP_M,
} from './lib/reach.js'

let kit = null
let tree = null // shortest routes from the current start point, for "Explore"

self.onmessage = ({ data }) => {
  try {
    handle(data)
  } catch (err) {
    // never leave the page waiting: report the failure instead
    if (data.type === 'reach') tree = null
    self.postMessage({ type: 'failed', of: data.type, requestId: data.requestId, message: String(err?.message ?? err) })
  }
}

function handle(data) {
  if (data.type === 'init') {
    const project = makeProjection(data.center)
    kit = {
      net: buildNetwork(data.graph, project),
      buildings: prepareBuildings(data.buildings, project),
      cells: prepareCells(data.zensus, project),
    }
    self.postMessage({ type: 'ready' })
  }

  if (data.type === 'reach') {
    const { node, distance } = nearestNode(kit.net, data.point)
    if (distance > MAX_SNAP_M) {
      tree = null
      self.postMessage({ type: 'tooFar', requestId: data.requestId, distance })
      return
    }
    const areas = computeReach(kit, node).map((a) => ({
      minutes: a.minutes,
      metres: a.metres,
      shape: a.shape,
      buildings: [...a.buildings],
      residents: a.residents,
      unknownCells: a.unknownCells,
    }))
    tree = shortestTree(kit.net, node.id)
    self.postMessage({ type: 'result', requestId: data.requestId, start: node.xy, snap: distance, areas })
  }

  // walking distance from the start point to each place (null: no walkable node within 100 m)
  if (data.type === 'distances') {
    const metres = data.points.map((p) => {
      const { node, distance } = nearestNode(kit.net, p)
      return distance > MAX_SNAP_M ? null : (tree?.dist.get(node.id) ?? null)
    })
    self.postMessage({ type: 'distances', requestId: data.requestId, metres })
  }

  if (data.type === 'route') {
    const route = tree ? routeTo(kit.net, tree, data.point) : { noStart: true }
    self.postMessage({ type: 'route', requestId: data.requestId, ...route })
  }
}
