import { useEffect, useMemo, useRef, useState } from 'react'
import City from './City.jsx'
import { makeProjection, prepareBuildings, WALK_M_PER_MIN, BAND_M, MAX_SNAP_M, MINUTES } from './lib/reach.js'
import { USES, REACH_COLORS, EXPLORE_COLOR, ROUTE_COLOR } from './palette.js'
import { INTERESTS, placesFor } from './interests.js'
import { buildingPoint } from './buildingPoint.js'

const ATTRIBUTION =
  'Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).'

async function loadJson(name) {
  // BASE_URL makes the same path work on localhost and on GitHub Pages
  const r = await fetch(`${import.meta.env.BASE_URL}data/${name}`)
  if (!r.ok) throw new Error(`data/${name}: ${r.status}`)
  return r.json()
}

const fmt = (n) => n.toLocaleString('en-GB')
const useLabel = (use) => USES.find((u) => u.use === use)?.label ?? use
// The buildings have no names, so a place is called by its main use, plus the use that puts it
// in the chosen interest when that is a smaller one (for example "Residential, with food and drink").
const placeName = (b, interest) => {
  const extra = interest ? b.uses.filter((u) => u !== b.use && interest.uses.includes(u)) : []
  if (!extra.length || interest.uses.includes(b.use)) return useLabel(b.use)
  return `${useLabel(b.use)}, with ${extra.map((u) => useLabel(u).toLowerCase()).join(' and ')}`
}
const pointInShape = ([x, y], shape) =>
  shape.some(([outer, ...holes]) => inRing(x, y, outer) && !holes.some((h) => inRing(x, y, h)))
function inRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const minutes = (m) => {
  const min = Math.round(m / WALK_M_PER_MIN)
  return min < 1 ? 'under 1 min' : `${min} min`
}

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reach, setReach] = useState(null)
  const [message, setMessage] = useState(null)
  const [exploreOpen, setExploreOpen] = useState(false)
  const [interestKey, setInterestKey] = useState(null)
  // the destination: a marked building { building: index } or a free point { point: [x, y] }
  const [dest, setDest] = useState(null)
  const [pointMode, setPointMode] = useState(false) // "Route to a point": the next ground click is the destination
  const [route, setRoute] = useState(null)
  const [routeMessage, setRouteMessage] = useState(null)
  const [distances, setDistances] = useState(null)
  const worker = useRef(null)
  const lastRequest = useRef(0)
  const lastRoute = useRef(0)
  const lastDistances = useRef(0)

  useEffect(() => {
    let alive = true
    const w = new Worker(new URL('./reach.worker.js', import.meta.url), { type: 'module' })
    worker.current = w
    w.onmessage = ({ data: msg }) => {
      if (msg.type === 'ready') return setReady(true)
      if (msg.type === 'distances') {
        if (msg.requestId === lastDistances.current) setDistances(msg.metres)
        return
      }
      if (msg.type === 'failed') {
        if (msg.of === 'route' && msg.requestId === lastRoute.current)
          setRouteMessage('The route could not be calculated. Try another destination.')
        if (msg.of === 'reach' && msg.requestId === lastRequest.current) {
          setBusy(false)
          setReach(null)
          setMessage('The walk from this point could not be calculated. Click a little further along the street.')
        }
        return
      }
      if (msg.type === 'route') {
        if (msg.requestId !== lastRoute.current) return // an older click, already replaced
        if (msg.noStart) setRouteMessage('There is no start point yet. Click the ground to set your start.')
        else if (msg.tooFar)
          setRouteMessage(`No walkable street within ${MAX_SNAP_M} m of this destination (the nearest is ${fmt(Math.round(msg.snap))} m away), so there is no route to it.`)
        else if (msg.unreachable) setRouteMessage('This destination can\'t be reached on the walkable network from the start point.')
        else {
          setRoute(msg)
          setRouteMessage(null)
        }
        return
      }
      if (msg.requestId !== lastRequest.current) return // an older click, already replaced
      setBusy(false)
      if (msg.type === 'tooFar') {
        setReach(null)
        setMessage(`No walkable street within ${MAX_SNAP_M} m of this point. The nearest is ${fmt(Math.round(msg.distance))} m away. Click closer to a street.`)
      } else {
        setReach(msg)
        setMessage(null)
      }
    }
    Promise.all(['kit.json', 'buildings.geojson', 'streets.graph.json', 'zensus.geojson'].map(loadJson))
      .then(([kit, buildings, graph, zensus]) => {
        if (!alive) return
        w.postMessage({ type: 'init', center: kit.center, buildings, graph, zensus })
        const project = makeProjection(kit.center)
        setData({
          kit,
          buildings: prepareBuildings(buildings, project),
          edges: graph.edges.filter((e) => e.walkable).map((e) => e.coords.map(project)),
        })
      })
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
      w.terminate()
    }
  }, [])

  const clearRoute = () => {
    lastRoute.current += 1 // ignore a route that is still being calculated
    setRoute(null)
    setRouteMessage(null)
    setDest(null)
  }

  // Ask the worker for the route to a destination. The worker answers messages in order, so a route
  // asked for right after a new start point is calculated from that new start.
  const requestRoute = (d) => {
    lastRoute.current += 1
    setRoute(null)
    setRouteMessage(null)
    const point = d.building != null ? buildingPoint(data.buildings[d.building]) : d.point
    worker.current.postMessage({ type: 'route', requestId: lastRoute.current, point })
  }

  // A click on the ground. Normally a new start point, which also recalculates the route to the
  // destination chosen so far. With "Route to a point" on, it is a free destination instead.
  const pick = (point) => {
    if (!ready) return
    if (pointMode) {
      const d = { point }
      setDest(d)
      setPointMode(false)
      requestRoute(d)
      return
    }
    lastRequest.current += 1
    setBusy(true)
    setMessage(null)
    worker.current.postMessage({ type: 'reach', requestId: lastRequest.current, point })
    if (dest) requestRoute(dest)
  }

  const interest = INTERESTS.find((i) => i.key === interestKey) ?? null
  const counts = useMemo(
    () => (data ? Object.fromEntries(INTERESTS.map((i) => [i.key, placesFor(i, data.buildings).length])) : {}),
    [data],
  )
  const places = useMemo(() => (data && interest ? placesFor(interest, data.buildings) : []), [data, interest])

  // a new interest drops a building destination (it may not be marked any more), but keeps a free point
  const chooseInterest = (key) => {
    setInterestKey(key)
    if (dest?.building != null) clearRoute()
  }

  // A click on a marked building, its marker or its entry in the list: it becomes the destination.
  const showRoute = (index) => {
    const d = { building: index }
    setDest(d)
    setPointMode(false)
    requestRoute(d)
  }
  const selected = dest?.building ?? null

  // walking distance from the start point to every marked place, for the list
  useEffect(() => {
    setDistances(null)
    if (!reach || !places.length) return
    lastDistances.current += 1
    worker.current.postMessage({
      type: 'distances',
      requestId: lastDistances.current,
      points: places.map((i) => buildingPoint(data.buildings[i])),
    })
  }, [reach, places, data])

  // the list of places, nearest first once there is a start point
  const placeList = useMemo(() => {
    const list = places.map((index, k) => ({ index, metres: distances?.[k] ?? null }))
    if (distances) list.sort((a, b) => (a.metres ?? Infinity) - (b.metres ?? Infinity))
    return list
  }, [places, distances])

  // the smallest reach area a building lies in, as 0, 1 or 2; -1 if it lies outside all three
  const areaOf = (index) => (reach ? reach.areas.findIndex((a) => a.buildings.includes(index)) : -1)

  const presentUses = useMemo(() => {
    if (!data) return []
    const seen = new Set(data.buildings.map((b) => b.use))
    return USES.filter((u) => seen.has(u.use))
  }, [data])

  if (error) return <p className="error">The city kit didn't load ({error}).</p>
  if (!data) return <p className="loading">Loading the city kit…</p>

  const sel = selected != null ? data.buildings[selected] : null
  const destArea = !dest || !reach ? -1 : sel ? areaOf(selected) : reach.areas.findIndex((a) => pointInShape(dest.point, a.shape))
  // what the next click on the map will do
  const exploring = exploreOpen || dest
  const nextClick = !ready
    ? 'Preparing the street network…'
    : busy
      ? 'Calculating…'
      : pointMode
        ? 'Next click: Click a building or point to set your destination.'
        : !exploring
          ? 'Click on the ground to start a walk from there.'
          : !reach
            ? 'Next click: Click the ground to set your start.'
            : 'Next click: Click a building or point to set your destination (a marked building, its list entry, or a free point with "Route to a point"). A click on the ground sets a new start.'

  return (
    <div className="app">
      <City
        size={data.kit.size_m}
        buildings={data.buildings}
        edges={data.edges}
        reach={reach}
        onPick={pick}
        places={places}
        selected={selected}
        onSelect={showRoute}
        route={route}
        target={dest?.point ?? null}
      />

      <aside className="panel">
        <h1>Walking reach in {data.kit.label}</h1>
        <p className="hint">
          {nextClick}
        </p>
        {message && <p className="message">{message}</p>}

        <table>
          <thead>
            <tr>
              <th>Walk</th>
              <th>Buildings</th>
              <th>Residents</th>
            </tr>
          </thead>
          <tbody>
            {MINUTES.map((min, i) => {
              const a = reach?.areas[i]
              return (
                <tr key={min}>
                  <td>
                    <span className="swatch" style={{ background: REACH_COLORS[i] }} />
                    {min} min
                  </td>
                  <td>{a ? fmt(a.buildings.length) : '–'}</td>
                  <td>
                    {a ? `about ${fmt(a.residents)}` : '–'}
                    {a?.unknownCells > 0 && (
                      <span className="unknown">
                        {' '}
                        + {a.unknownCells} {a.unknownCells === 1 ? 'cell' : 'cells'} without a figure
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {interest && (
          <section className="explore-list">
            <h2>
              <span className="swatch" style={{ background: EXPLORE_COLOR }} />
              {interest.label}
            </h2>
            {places.length === 0 ? (
              <p className="message">{interest.empty}</p>
            ) : (
              <>
                <p className="note">
                  {reach
                    ? 'Nearest first, by walking distance from the start point. Click a place, its marker or the building for the route.'
                    : 'Click on the ground to set a start point: the list is then sorted by walking distance.'}
                </p>
                <ol>
                  {placeList.map(({ index, metres }) => (
                    <li key={index}>
                      <button className={index === selected ? 'link on' : 'link'} onClick={() => showRoute(index)}>
                        {placeName(data.buildings[index], interest)}, building {data.buildings[index].id}
                      </button>
                      {distances && (
                        <span className="count">
                          {' '}
                          {metres == null ? 'no street within 100 m' : `${fmt(Math.round(metres))} m, ${minutes(metres)}`}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        )}

        {dest && (
          <section className="route">
            <h2>
              <span className="swatch" style={{ background: ROUTE_COLOR }} />
              {sel ? `Route to ${placeName(sel, interest)}, building ${sel.id}` : 'Route to a point'}
            </h2>
            {routeMessage && <p className="message">{routeMessage}</p>}
            {route && (
              <>
                <p className="big">
                  {fmt(Math.round(route.length))} m, about {minutes(route.length)} on foot
                </p>
                <p>
                  {destArea >= 0 ? (
                    <>
                      <span className="swatch" style={{ background: REACH_COLORS[destArea] }} />
                      The {sel ? 'building' : 'point'} lies in the {MINUTES[destArea]} minute area.
                    </>
                  ) : (
                    `The ${sel ? 'building' : 'point'} lies outside the 15 minute area.`
                  )}
                </p>
                <p className="note">
                  The route runs from the start point to the street junction nearest the {sel ? 'building' : 'point'} ({fmt(Math.round(route.snap))} m
                  from it). The data has no street names, so there are no step-by-step directions.
                </p>
              </>
            )}
            <button onClick={clearRoute}>Clear route</button>
          </section>
        )}

        <div className="method">
          <p>
            The walk starts at the street junction nearest to your click (up to {MAX_SNAP_M} m away) and follows the
            pedestrian network at 4.8 km/h, which is {WALK_M_PER_MIN} m per minute. A street that is only partly
            reached counts up to where the time runs out.
          </p>
          <p>
            Each area is a band of {BAND_M} m on each side of the reached streets, joined into one shape. A building
            counts if its footprint touches the band. The counts include the smaller areas: the 10 minute figures
            contain the 5 minute ones.
          </p>
          <p>
            Residents come from the Zensus 2022 grid of 100 m cells. Each cell that overlaps an area adds its residents
            times the share of the cell's area that lies inside. The sum is rounded to the nearest 10. Cells without a
            published figure aren't zero: they are left out of the sum and counted separately.
          </p>
        </div>
      </aside>

      <div className="side">
        <div className="toolbar">
          <button onClick={() => setExploreOpen(!exploreOpen)} aria-expanded={exploreOpen}>
            Explore
          </button>
        </div>

        {exploreOpen && (
          <section className="box explore">
            <h2>Places by interest</h2>
            <div className="choices">
              {INTERESTS.map((i) => (
                <label key={i.key}>
                  <input type="radio" name="interest" checked={interestKey === i.key} onChange={() => chooseInterest(i.key)} />
                  {i.label} <span className="count">({counts[i.key]})</span>
                </label>
              ))}
              <label>
                <input type="radio" name="interest" checked={!interestKey} onChange={() => chooseInterest(null)} />
                None
              </label>
            </div>
            {interest && (
              <>
                {places.length === 0 && <p className="message">{interest.empty}</p>}
                <p className="note">{interest.note}</p>
              </>
            )}
            <button className="toggle" aria-pressed={pointMode} onClick={() => setPointMode(!pointMode)}>
              Route to a point
            </button>
            <p className="note">
              {pointMode
                ? 'On: your next click on the ground sets the destination.'
                : 'Turn on, then click the ground to walk to any point.'}
            </p>
          </section>
        )}

        <aside className="box legend">
          <h2>Main use</h2>
          <ul>
            {presentUses.map((u) => (
              <li key={u.use}>
                <span className="swatch" style={{ background: u.color }} />
                {u.label}
              </li>
            ))}
          </ul>
          <h2>Reached on foot</h2>
          <ul>
            {MINUTES.map((m, i) => (
              <li key={m}>
                <span className="swatch" style={{ background: REACH_COLORS[i] }} />
                within {m} min
              </li>
            ))}
          </ul>
          {interest && places.length > 0 && (
            <ul>
              <li>
                <span className="swatch" style={{ background: EXPLORE_COLOR }} />
                {interest.label}
              </li>
            </ul>
          )}
          {route && (
            <ul>
              <li>
                <span className="swatch" style={{ background: ROUTE_COLOR }} />
                Walking route
              </li>
            </ul>
          )}
          <p className="controls">Drag to orbit, right-drag to pan, scroll to zoom.</p>
        </aside>
      </div>

      <footer className="attribution">{ATTRIBUTION}</footer>
    </div>
  )
}
