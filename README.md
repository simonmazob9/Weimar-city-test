# Walking reach in Weimar

A 3D web app that shows how far you can walk in 5, 10 and 15 minutes from any point in central Weimar, which buildings you reach, and about how many people live there.

The city is shown in 3D: every building is extruded from its footprint to its measured height and coloured by its main use, with a legend. The pedestrian network is drawn as thin lines. Click on the ground and the app draws three nested areas in three shades of blue, highlights the buildings that touch each area in the matching shade, and lists, for each area, the number of buildings reached and about how many residents live there.

## Run it

```
npm install     install the packages
npm run dev     start the app at http://localhost:5173
```

Drag to orbit, right-drag to pan, scroll to zoom. Click on the ground to start a walk.

Every push to `main` publishes the app to GitHub Pages at `https://<user>.github.io/<repo>/`, through `.github/workflows/deploy.yml`.

## Method and its limits

- **Start.** The walk starts at the walkable node of the pedestrian network (a junction or a dead end) that is nearest to your click. If no node is within 100 m, the app says so and draws nothing. The way from your click to that node is not counted as walking time.
- **Walking speed.** 4.8 km/h, which is 80 m per minute: 400 m in 5 minutes, 800 m in 10, 1,200 m in 15. Distances are the `length` of each street edge, along the network, shortest path. Everyone walks at the same speed; slopes, steps, crossings and waiting at traffic lights are not taken into account.
- **The 25 m band.** Each area is every street segment reached in that time, including the reachable part of the last segment, with a band of 25 m on each side, joined into one shape. It is not a circle and not a convex hull. A building counts as reached if its footprint touches the band. The counts are nested: the 10 minute figures include the 5 minute ones.
- **Residents.** They come from the Zensus 2022 grid of 100 m cells. For every cell that overlaps an area, the app takes the cell's population times the share of the cell's area that lies inside the area, adds these up, and rounds to the nearest 10. This assumes people are spread evenly over each cell, which they are not: they live in the buildings. The census also changes small counts slightly at random to protect privacy, so the figures are approximate.
- **Cells without a figure.** Some cells have no published resident count (`population` is `null`). They are not zero. They are left out of the sum, and the panel shows how many such cells overlap each area.
- **Edge of the kit.** The data stops at the edge of the kit area. A walk near the edge looks shorter than it really is, because streets, buildings and residents outside the kit are missing.

## Explore: places by interest and the route to them

The "Explore" button at the top right opens a small selector with four interests. Pick one and the app colours the buildings of that interest magenta, puts a marker above each, and lists them in the panel. Once there is a start point, the list is sorted nearest first, by walking distance.

### Start and destination

The line under the title in the panel always says what your next click will do.

- **Start:** a click on the ground (or on an unmarked building) always sets the start point and draws the 5, 10 and 15 minute areas, whatever else is shown.
- **A building as destination:** click a marked building, its marker or its entry in the list. The app draws the walking route from the start point to it.
- **A free point as destination:** turn on "Route to a point" in the Explore box. Your next click on the ground sets the destination there, and the switch turns itself off. A pole marks the point, and a thin dashed line joins it to the street junction where the route ends.
- **A new start keeps the destination:** with a destination chosen, a new click on the ground moves the start and recalculates the route from there.
- Without a start point, the panel asks you to click the ground first; the route appears as soon as you do.
- "Clear route" removes the destination and the route. Choosing another interest drops a building destination, but keeps a free point.

The route is an orange line slightly above the streets, with small dark arrows in the walking direction and an orange ring at each end. The panel shows the distance in metres, the walking time in minutes, and whether the destination lies in the 5, 10 or 15 minute area. Only one route is shown at a time.

### Which buildings belong to each interest

The buildings have six fields: `id`, `height`, `height_source`, `floors`, `use` and `floor_area_m2`. There is no name, no amenity, shop or tourism tag and no heritage flag. Two fields tell what a building is used for: `use`, the use with the largest floor area, and `floor_area_m2`, the floor area of every use in the building. A building belongs to an interest if it has any floor area of one of the interest's uses, so a café on the ground floor of a residential building counts too.

| Interest | Rule (`floor_area_m2` has floor area of …) | Buildings |
| --- | --- | --- |
| Art and design | `culture` | 22 |
| History | none: nothing in the data marks history museums, monuments, churches or historic buildings | 0 |
| Tourist | `culture`, `entertainment` or `accommodation` | 140 |
| Markets and food | `food_and_drink` | 185 |

- `culture` doesn't tell a museum or gallery from a theatre or library.
- Markets and food: the data has no use for market halls, weekly markets, supermarkets or food shops. Shops are all `retail` (145 buildings), with no way to tell a food shop from any other shop, so they are left out. Marketplaces such as the Markt are open squares, not buildings.
- The buildings have no names, so the list calls each one by its main use (plus the use that puts it in the interest, if that is a smaller one) and its building id.
- For History the app says plainly that the data has no such buildings.

### How the route is computed

- The route follows only the walkable edges of `streets.graph.json`. It is the shortest path by the edges' `length` in metres (Dijkstra's algorithm), from the start node of the reach to the walkable node nearest the destination.
- For a building, the destination is the middle of the largest triangle of its footprint, which always lies on the building. For a free point, it is where you clicked.
- The same 100 m rule applies to both ends: if no walkable street is within 100 m of the start or of the destination, the app says so and draws no route.
- Walking time is the distance divided by 80 m per minute, rounded to the nearest minute.
- The edges have no street names, so the app gives no step-by-step directions and says so.

### The Bauhaus campus

Not marked yet. The data can't identify the Bauhaus museum or the campus buildings: there are no names, and the only fields that hint at what a building is, `use` and `floor_area_m2`, are shared with many other buildings. They will be marked once a point is given for each building.

### Limits

- Only places that are in the data can be shown, and only as precisely as their uses describe them: museums, churches, monuments or markets missing from the data, or hidden under another use, can't be shown.
- Routes run only on the graph's walkable edges. The way from the start point to the first junction and from the last junction to the destination is not included.
- Everyone walks at a fixed 80 m per minute; slopes, steps, crossings and waiting are not taken into account.

## Data sources

All data is in `public/data/` and described in `public/data/SOURCES.md`. Nothing is fetched from the internet.

| File | Source | Licence |
| --- | --- | --- |
| `buildings.geojson` | footprints and heights: 3D building models LoD2 of Thuringia, © GDI-Th; uses: Egor Gaydukov | dl-de/by-2-0 |
| `streets.graph.json` | pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar | |
| `zensus.geojson` | Zensus 2022, 100 m grid, © Statistische Ämter des Bundes und der Länder | dl-de/by-2-0 |

Buildings: 3D building models LoD2 © GDI-Th (dl-de/by-2-0). Land use and pedestrian network: Egor Gaydukov, InfAU, Bauhaus-Universität Weimar. Census grid: Zensus 2022, © Statistische Ämter des Bundes und der Länder (dl-de/by-2-0).

## How this was made

1. Tools: Claude Code, with the model Claude Opus 5.5 (`claude-opus-5-5`).
2. I decided: to add an Explore feature that marks places by visitor interest (art and design, history, tourist, markets) with walking routes, and to highlight the Bauhaus campus in its own style; I dropped a textured "game mode" because the result didn't look right, and kept to the kit's data only, with no invented places.
3. The agent did: it read the data kit and built the app (3D city, walking-network calculation in a background worker, resident count, panel, legend, Explore with four interests, start and destination clicks, free-point routes, and this README), fixed a crash in the area calculation that left the app stuck, then tested the clicks in a headless browser.
4. I checked: that clicking the ground draws the 5/10/15 minute areas and updates the panel, that each interest marks the right buildings, that routes to a building and to a free point follow the streets, and that the published GitHub Pages link works.
