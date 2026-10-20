import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Line } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { USE_COLOR, REACH_COLORS, EXPLORE_COLOR, ROUTE_COLOR, GROUND, STREET } from './palette.js'
import { ownerLookup } from './lookup.js'
import { buildingPoint } from './buildingPoint.js'

// The scene uses metres. The local map system has x to the east and y to the north;
// in three.js that becomes x to the east, y up, and z to the south (z = -north).

// All buildings in one mesh: walls and a flat roof at `height`, one colour per building.
function buildingGeometry(buildings) {
  const pos = []
  const ranges = [] // where each building's vertices sit in the arrays, for recolouring
  for (const b of buildings) {
    const start = pos.length / 3
    const h = b.height
    const rings = b.rings.map((r) => r.slice(0, -1)) // drop the repeated closing point
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i]
        const [x2, y2] = ring[(i + 1) % ring.length]
        pos.push(x1, 0, -y1, x2, 0, -y2, x2, h, -y2)
        pos.push(x1, 0, -y1, x2, h, -y2, x1, h, -y1)
      }
    }
    const outer = rings[0].map(([x, y]) => new THREE.Vector2(x, y))
    const holes = rings.slice(1).map((r) => r.map(([x, y]) => new THREE.Vector2(x, y)))
    const all = [...outer, ...holes.flat()]
    for (const tri of THREE.ShapeUtils.triangulateShape(outer, holes))
      for (const k of tri) pos.push(all[k].x, h, -all[k].y)
    ranges.push([start, pos.length / 3 - start])
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geom.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3))
  geom.computeVertexNormals()
  geom.computeBoundingSphere()
  const owner = ownerLookup(ranges.map(([s]) => s), buildings.map((b) => b.index))
  return { geom, ranges, owner }
}

function Buildings({ buildings, reach, highlight }) {
  const { geom, ranges, owner } = useMemo(() => buildingGeometry(buildings), [buildings])

  // Colour by use, then paint over the buildings each reach area touches,
  // from the largest area to the smallest, so each building shows its closest area.
  // Places picked in "Explore" are painted last.
  useEffect(() => {
    const colors = buildings.map((b) => new THREE.Color(USE_COLOR[b.use] ?? USE_COLOR.undefined))
    if (reach)
      for (let i = reach.areas.length - 1; i >= 0; i--) {
        const c = new THREE.Color(REACH_COLORS[i])
        for (const index of reach.areas[i].buildings) colors[index] = c
      }
    if (highlight) {
      const c = new THREE.Color(EXPLORE_COLOR)
      for (const index of highlight) colors[index] = c
    }
    const attr = geom.getAttribute('color')
    buildings.forEach((b, i) => {
      const [start, count] = ranges[i]
      const { r, g, b: bl } = colors[i]
      for (let v = start; v < start + count; v++) attr.setXYZ(v, r, g, bl)
    })
    attr.needsUpdate = true
  }, [buildings, reach, highlight, geom, ranges])

  return (
    <mesh geometry={geom} userData={{ owner }}>
      <meshLambertMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  )
}

function Streets({ edges }) {
  const geom = useMemo(() => {
    const pos = []
    for (const e of edges)
      for (let i = 1; i < e.length; i++) pos.push(e[i - 1][0], 1.2, -e[i - 1][1], e[i][0], 1.2, -e[i][1])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [edges])
  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial color={STREET} />
    </lineSegments>
  )
}

// A reach area: a MultiPolygon in metres, laid flat on the ground. It is drawn as a lighter tint of
// its shade, so the buildings in the full shade still stand out against it.
function Area({ shape, color, lift }) {
  const tint = useMemo(() => {
    const hsl = new THREE.Color(color).getHSL({})
    return new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l + 0.2 * (1 - hsl.l))
  }, [color])
  const geom = useMemo(() => {
    const shapes = shape.map(([outer, ...holes]) => {
      const s = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)))
      s.holes = holes.map((h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
      return s
    })
    return new THREE.ShapeGeometry(shapes)
  }, [shape])
  return (
    <mesh geometry={geom} rotation={[-Math.PI / 2, 0, 0]} position={[0, lift, 0]}>
      <meshBasicMaterial color={tint} />
    </mesh>
  )
}

// ---------- markers above the places picked in "Explore" ----------

const pinGeometry = (() => {
  const cone = new THREE.ConeGeometry(3, 9, 12)
  cone.rotateX(Math.PI) // point down
  cone.translate(0, 4.5, 0)
  const ball = new THREE.SphereGeometry(3.6, 16, 12)
  ball.translate(0, 10, 0)
  return mergeGeometries([cone, ball])
})()

function Markers({ buildings, places, selected, onSelect }) {
  const mesh = useRef()
  const lastScale = useRef(0)
  const anchors = useMemo(
    () =>
      places.map((index) => {
        const b = buildings[index]
        const [x, y] = buildingPoint(b)
        return [x, b.height + 4, -y]
      }),
    [buildings, places],
  )

  // Markers grow a little when you zoom out, so they stay easy to find, but never so much that
  // they cover the ground you want to click.
  useFrame(({ camera, controls }) => {
    if (!mesh.current) return
    const target = controls?.target ?? new THREE.Vector3()
    const scale = THREE.MathUtils.clamp(camera.position.distanceTo(target) / 700, 1, 3)
    if (Math.abs(scale - lastScale.current) < 0.02 && mesh.current.userData.count === anchors.length) return
    lastScale.current = scale
    mesh.current.userData.count = anchors.length
    const m = new THREE.Matrix4()
    const color = new THREE.Color()
    anchors.forEach(([x, y, z], i) => {
      m.makeScale(scale, scale, scale).setPosition(x, y, z)
      mesh.current.setMatrixAt(i, m)
      mesh.current.setColorAt(i, color.set(places[i] === selected ? '#1c1c1c' : EXPLORE_COLOR))
    })
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    mesh.current.computeBoundingSphere()
  })

  // a new selection (its marker turns dark) or a new list of places: redraw the markers
  useEffect(() => {
    lastScale.current = 0
  }, [selected, anchors])

  if (!places.length) return null
  return (
    <instancedMesh
      key={places.length}
      ref={mesh}
      args={[pinGeometry, undefined, places.length]}
      onClick={(e) => {
        if (e.delta > 4) return
        e.stopPropagation()
        onSelect(places[e.instanceId])
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <meshLambertMaterial emissive={EXPLORE_COLOR} emissiveIntensity={0.35} />
    </instancedMesh>
  )
}

// ---------- the walking route to a place ----------

const ROUTE_Y = 3 // metres: slightly above the streets (1.2 m) and the reach areas
const ARROW_EVERY = 35 // metres between direction arrows

const arrowGeometry = (() => {
  const g = new THREE.ConeGeometry(4.5, 12, 3)
  g.rotateZ(-Math.PI / 2) // point along +x
  return g
})()

function Route({ route }) {
  const points = useMemo(() => route.line.map(([x, y]) => new THREE.Vector3(x, ROUTE_Y, -y)), [route])
  // small arrows along the line, pointing the way you walk
  const arrows = useMemo(() => {
    const out = []
    let next = ARROW_EVERY / 2
    let s = 0
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]
      const b = points[i]
      const len = a.distanceTo(b)
      while (len > 0 && next <= s + len) {
        const t = (next - s) / len
        out.push({ pos: a.clone().lerp(b, t), angle: Math.atan2(-(b.z - a.z), b.x - a.x) })
        next += ARROW_EVERY
      }
      s += len
    }
    return out
  }, [points])
  const mesh = useRef()
  useEffect(() => {
    const m = new THREE.Matrix4()
    arrows.forEach(({ pos, angle }, i) => {
      m.makeRotationY(angle).setPosition(pos.x, ROUTE_Y + 0.5, pos.z)
      mesh.current.setMatrixAt(i, m)
    })
    mesh.current.instanceMatrix.needsUpdate = true
    mesh.current.computeBoundingSphere()
  }, [arrows])

  const end = points[points.length - 1]
  const start = points[0]
  return (
    <group>
      <Line points={points} color={ROUTE_COLOR} lineWidth={6} />
      {arrows.length > 0 && (
        <instancedMesh key={arrows.length} ref={mesh} args={[arrowGeometry, undefined, arrows.length]}>
          <meshBasicMaterial color="#6b2a00" />
        </instancedMesh>
      )}
      {[start, end].map((p, i) => (
        <mesh key={i} position={[p.x, ROUTE_Y, p.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[6, 10, 32]} />
          <meshBasicMaterial color={ROUTE_COLOR} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <mesh position={[end.x, ROUTE_Y + 6, end.z]}>
        <cylinderGeometry args={[0.8, 0.8, 12, 8]} />
        <meshBasicMaterial color={ROUTE_COLOR} />
      </mesh>
    </group>
  )
}

// A free destination from "Route to a point": a pole where you clicked, and a thin dashed line to the
// street junction where the route ends (that last bit is not part of the walked distance).
function Target({ point, end }) {
  const [x, y] = point
  return (
    <group>
      <mesh position={[x, ROUTE_Y + 9, -y]}>
        <cylinderGeometry args={[0.8, 0.8, 18, 8]} />
        <meshBasicMaterial color={ROUTE_COLOR} />
      </mesh>
      <mesh position={[x, ROUTE_Y + 19, -y]}>
        <sphereGeometry args={[3, 16, 12]} />
        <meshBasicMaterial color={ROUTE_COLOR} />
      </mesh>
      {end && (
        <Line points={[[end[0], ROUTE_Y, -end[1]], [x, ROUTE_Y, -y]]} color={ROUTE_COLOR} lineWidth={2} dashed dashSize={4} gapSize={3} />
      )}
    </group>
  )
}

export default function City({ size, buildings, edges, reach, onPick, places, selected, onSelect, route, target }) {
  const [w, h] = size
  const ground = Math.max(w, h) + 1200
  const highlight = useMemo(() => (places.length ? new Set(places) : null), [places])

  const handleClick = (e) => {
    if (e.delta > 4) return // that was a drag to orbit or pan, not a click
    e.stopPropagation()
    // a click on a building picked in "Explore" selects it instead of starting a walk
    const owner = e.object.userData.owner
    if (highlight && owner && e.faceIndex != null) {
      const index = owner(e.faceIndex * 3)
      if (highlight.has(index)) return onSelect(index)
    }
    onPick([e.point.x, -e.point.z])
  }

  return (
    <Canvas camera={{ position: [0, 1300, 1500], fov: 40, near: 5, far: 20000 }} dpr={[1, 2]}>
      <color attach="background" args={['#e4e2dc']} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[-600, 1200, 400]} intensity={1.6} />
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.05} minDistance={60} maxDistance={5000} />
      <group onClick={handleClick}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[ground, ground]} />
          <meshBasicMaterial color={GROUND} />
        </mesh>
        {reach &&
          // largest first and lowest, so the smaller areas lie on top
          [...reach.areas]
            .map((a, i) => ({ ...a, i }))
            .reverse()
            .map((a, k) => <Area key={a.minutes} shape={a.shape} color={REACH_COLORS[a.i]} lift={0.3 + k * 0.3} />)}
        <Buildings buildings={buildings} reach={reach} highlight={highlight} />
      </group>
      <Streets edges={edges} />
      {route && <Route route={route} />}
      {target && <Target point={target} end={route?.end} />}
      <Markers buildings={buildings} places={places} selected={selected} onSelect={onSelect} />
      {reach && (
        <mesh position={[reach.start[0], 6, -reach.start[1]]}>
          <sphereGeometry args={[6, 24, 16]} />
          <meshBasicMaterial color="#111" />
        </mesh>
      )}
    </Canvas>
  )
}
