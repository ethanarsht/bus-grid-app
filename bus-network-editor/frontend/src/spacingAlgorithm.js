function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6_371_000
  const phi1 = lat1 * Math.PI / 180, phi2 = lat2 * Math.PI / 180
  const dphi = (lat2 - lat1) * Math.PI / 180
  const dlam = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * Iterative stop-spacing decision tree.
 *
 * For each stop (in route-sequence order), if removing it would produce a gap
 * between its predecessor and successor that falls within [minFt, maxFt] feet,
 * the stop is marked for removal and the chain is updated before moving on.
 *
 * A stop is only included in the final removal set if every route it serves
 * independently flags it — so shared stops are kept unless all their routes agree.
 */
export function runSpacingAlgorithm(projectedStops, baselineSegments, minM = 350, maxM = 400) {

  // Build stop position + route membership from the current projected state
  const stopPos = {}
  for (const f of projectedStops.features) {
    const [lon, lat] = f.geometry.coordinates
    const routes = f.properties.routes
    stopPos[String(f.properties.stop_id)] = {
      lat, lon,
      routes: Array.isArray(routes) ? routes.map(String) : [],
    }
  }

  // Build next/prev adjacency per (route, direction) from baseline segments
  const chainMaps = {}
  for (const f of baselineSegments.features) {
    const p = f.properties
    const key = `${p.route_id}__${p.direction_id}`
    if (!chainMaps[key]) chainMaps[key] = { next: {}, prev: {}, routeId: String(p.route_id) }
    chainMaps[key].next[String(p.stop_id1)] = String(p.stop_id2)
    chainMaps[key].prev[String(p.stop_id2)] = String(p.stop_id1)
  }

  // routeId → Set of stop_ids flagged by that route's analysis
  const flaggedByRoute = {}

  for (const { next, prev, routeId } of Object.values(chainMaps)) {
    // Find chain starts: stops with no predecessor in this route/direction
    const allStops = new Set([...Object.keys(next), ...Object.values(next)])
    const starts = [...allStops].filter(s => !prev[s])

    for (const start of starts) {
      // Build ordered chain of currently-active stops, skipping any already removed
      const chain = []
      const visited = new Set()
      let cur = start
      while (cur && !visited.has(cur)) {
        visited.add(cur)
        if (stopPos[cur]) chain.push(cur)
        cur = next[cur]
      }
      if (chain.length < 3) continue

      // Iterative pass: evaluate each interior stop against its live neighbors
      let i = 1
      while (i < chain.length - 1) {
        const pred = chain[i - 1], curr = chain[i], succ = chain[i + 1]
        const a = stopPos[pred], b = stopPos[succ]
        if (!a || !b) { i++; continue }

        const gap = haversineM(a.lat, a.lon, b.lat, b.lon)
        if (gap >= minM && gap <= maxM) {
          if (!flaggedByRoute[routeId]) flaggedByRoute[routeId] = new Set()
          flaggedByRoute[routeId].add(curr)
          chain.splice(i, 1)
          // Don't advance i — recheck this position with updated neighbors
        } else {
          i++
        }
      }
    }
  }

  // Only remove a stop if every route it serves flagged it
  const result = new Set()
  for (const [routeId, flaggedSet] of Object.entries(flaggedByRoute)) {
    for (const stopId of flaggedSet) {
      const routes = stopPos[stopId]?.routes ?? []
      if (routes.length === 0) continue
      if (routes.every(r => flaggedByRoute[r]?.has(stopId))) {
        result.add(stopId)
      }
    }
  }

  return [...result]
}
