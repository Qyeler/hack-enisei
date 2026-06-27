const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const defaultSource = path.join(root, 'pipisa.json');
const sourcePath = process.argv[2] || defaultSource;
const outDir = path.join(root, 'app_data');
const rawOut = path.join(outDir, 'pipisa_scenario.json');
const routeOut = path.join(outDir, 'scenario.route');
const metaOut = path.join(outDir, 'scenario_meta.json');
const graphOut = path.join(outDir, 'route_graph_georef.geojson');
const zonesOut = path.join(outDir, 'surface_zones.geojson');
const osmOverpassPath = path.join(outDir, 'krasnoyarsk_osm_overpass.json');
const osmWaterwaysPath = path.join(outDir, 'krasnoyarsk_osm_waterways.json');
const osmBarriersPath = path.join(outDir, 'krasnoyarsk_osm_barriers.json');

const anchorCoordinates = {
  'Дивногорск': { lat: 55.959644, lon: 92.37542, source: 'OpenStreetMap Nominatim' },
  'Бирюса': { lat: 55.923534, lon: 91.974628, source: 'OpenStreetMap Nominatim: Верхняя Бирюса as finish-area proxy' },
  'КрасГЭС': { lat: 55.9369, lon: 92.2868, source: 'manual_workspace_seed: Krasnoyarsk HPP water area' },
  'Усть-Мана': { lat: 55.9318, lon: 92.4976, source: 'manual_workspace_seed: Mana confluence water area' },
  'Красноярск': { lat: 56.0106, lon: 92.8526, source: 'manual_workspace_seed: Krasnoyarsk city water area' },
  'Остров Отдыха': { lat: 55.9935, lon: 92.8298, source: 'manual_workspace_seed: city island water area' }
};

const graphBounds = {
  south: 55.84,
  west: 91.82,
  north: 56.10,
  east: 93.20
};

const workingAreaLabel = 'Акватория Красноярска: Бирюса, Дивногорск, КрасГЭС, Усть-Мана и городская часть Енисея';

const triangularMesh = {
  side_km: 0.16
};

const waterwayNodeSpacingKm = 0.12;
const waterwayGridConnectorKm = 0.42;
const smallWaterBodyMaxKm = 0.45;
const smallWaterBodyMicroTriangleKm = 0.06;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pipeLine(parts) {
  return parts.map((part) => String(part).replace(/\|/g, '/')).join('|');
}

function haversineKm(a, b) {
  const radiusKm = 6371;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(h));
}

function interpolateGeoPoint(a, b, t) {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t
  };
}

function densifyLine(points, spacingKm) {
  if (points.length < 2) return points;
  const dense = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const km = haversineKm(from, to);
    const steps = Math.max(1, Math.ceil(km / spacingKm));
    for (let step = 1; step <= steps; step++) {
      dense.push(interpolateGeoPoint(from, to, step / steps));
    }
  }
  return dense;
}

function polygonFeature(id, surface, label, coordinates, source = 'generated_seed_zone') {
  const rings = Array.isArray(coordinates?.[0]?.[0]) ? coordinates : [coordinates];
  const flat = rings.flat();
  const lons = flat.map((coord) => coord[0]);
  const lats = flat.map((coord) => coord[1]);
  return {
    type: 'Feature',
    id,
    properties: {
      id,
      surface,
      label,
      source,
      navigation_grade: false
    },
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    geometry: {
      type: 'Polygon',
      coordinates: rings
    }
  };
}

function signedRingArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

function closeRing(ring) {
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function pointKey(point) {
  return `${point[0].toFixed(7)},${point[1].toFixed(7)}`;
}

function isClosedRing(ring) {
  if (ring.length < 4) return false;
  return pointKey(ring[0]) === pointKey(ring[ring.length - 1]);
}

function geometryToRing(geometry) {
  return (geometry || []).map((point) => [point.lon, point.lat]);
}

function buildRingsFromLines(lines) {
  const unused = lines
    .filter((line) => line.length >= 2)
    .map((line) => [...line]);
  const rings = [];

  while (unused.length) {
    let ring = unused.shift();
    if (isClosedRing(ring)) {
      rings.push(ring);
      continue;
    }

    let changed = true;
    while (changed && !isClosedRing(ring)) {
      changed = false;
      for (let i = 0; i < unused.length; i++) {
        const candidate = unused[i];
        const ringStart = pointKey(ring[0]);
        const ringEnd = pointKey(ring[ring.length - 1]);
        const candidateStart = pointKey(candidate[0]);
        const candidateEnd = pointKey(candidate[candidate.length - 1]);

        if (ringEnd === candidateStart) {
          ring = ring.concat(candidate.slice(1));
        } else if (ringEnd === candidateEnd) {
          ring = ring.concat([...candidate].reverse().slice(1));
        } else if (ringStart === candidateEnd) {
          ring = candidate.concat(ring.slice(1));
        } else if (ringStart === candidateStart) {
          ring = [...candidate].reverse().concat(ring.slice(1));
        } else {
          continue;
        }
        unused.splice(i, 1);
        changed = true;
        break;
      }
    }

    if (isClosedRing(ring)) rings.push(ring);
  }

  return rings;
}

function osmSurface(tags = {}) {
  if (tags.natural === 'bare_rock' || tags.natural === 'shingle') return 'rocks';
  if (tags.natural === 'wetland') {
    if (tags.wetland === 'reedbed') return 'grass';
    return 'marsh';
  }
  if (tags.natural === 'water' || tags.waterway === 'riverbank') return 'ice';
  return null;
}

function waterwaySurface(tags = {}) {
  if (tags.waterway === 'river' || tags.waterway === 'canal' || tags.waterway === 'channel') return 'ice';
  if (tags.waterway === 'stream' && tags.boat === 'yes') return 'shallow';
  return null;
}

function surfacePriority(surface) {
  const order = {
    ice: 10,
    water: 20,
    shallow: 30,
    grass: 40,
    slush: 50,
    marsh: 60,
    rocks: 70
  };
  return order[surface] || 0;
}

function buildOsmLabel(tags = {}, surface, element) {
  const name = tags['name:ru'] || tags.name || tags.water || tags.wetland || tags.natural || surface;
  return `OSM: ${name} (${element.type}/${element.id})`;
}

function createZonesFromOsm(scenario) {
  if (!fs.existsSync(osmOverpassPath)) return null;
  const osm = JSON.parse(fs.readFileSync(osmOverpassPath, 'utf8'));
  const features = [];

  function addFeatureFromRing(id, surface, label, ring, element, holes = []) {
    const closed = closeRing(ring);
    if (closed.length < 4) return;
    const area = Math.abs(signedRingArea(closed));
    if (area < 0.000000015) return;
    const closedHoles = holes
      .map(closeRing)
      .filter((hole) => hole.length >= 4 && Math.abs(signedRingArea(hole)) >= 0.000000015);
    const feature = polygonFeature(id, surface, label, [closed, ...closedHoles], 'openstreetmap_overpass');
    feature.properties.osm_type = element.type;
    feature.properties.osm_id = element.id;
    feature.properties.osm_tags = element.tags || {};
    feature.properties.area_degrees2 = Number(area.toFixed(10));
    feature.properties.hole_count = closedHoles.length;
    features.push(feature);
  }

  for (const element of osm.elements || []) {
    const surface = osmSurface(element.tags);
    if (!surface || !scenario.surfaces?.[surface]) continue;

    if (element.type === 'way' && Array.isArray(element.geometry)) {
      addFeatureFromRing(
        `osm_${element.type}_${element.id}`,
        surface,
        buildOsmLabel(element.tags, surface, element),
        geometryToRing(element.geometry),
        element
      );
    }

    if (element.type === 'relation' && Array.isArray(element.members)) {
      const outerLines = element.members
        .filter((member) => member.type === 'way' && member.role !== 'inner' && Array.isArray(member.geometry))
        .map((member) => geometryToRing(member.geometry));
      const innerLines = element.members
        .filter((member) => member.type === 'way' && member.role === 'inner' && Array.isArray(member.geometry))
        .map((member) => geometryToRing(member.geometry));
      const rings = buildRingsFromLines(outerLines);
      const innerRings = buildRingsFromLines(innerLines);
      rings.forEach((ring, index) => {
        const holes = innerRings.filter((inner) => pointInRing(inner[0], ring));
        addFeatureFromRing(
          `osm_${element.type}_${element.id}_${index + 1}`,
          surface,
          buildOsmLabel(element.tags, surface, element),
          ring,
          element,
          holes
        );
      });
    }
  }

  features.sort((a, b) => {
    const bySurface = surfacePriority(a.properties.surface) - surfacePriority(b.properties.surface);
    if (bySurface) return bySurface;
    return (b.properties.area_degrees2 || 0) - (a.properties.area_degrees2 || 0);
  });

  if (!features.length) return null;
  return {
    type: 'FeatureCollection',
    name: 'surface_zones_from_openstreetmap_overpass',
    properties: {
      source: 'OpenStreetMap Overpass API',
      osm_base_timestamp: osm.osm3s?.timestamp_osm_base || null,
      query_bbox: [graphBounds.south, graphBounds.west, graphBounds.north, graphBounds.east],
      note: 'Водные полигоны OSM классифицированы как ice для зимнего сценария. Wetland и rocky surfaces оставлены как препятствия/штрафные зоны.'
    },
    features
  };
}

function createDefaultSurfaceZones() {
  return {
    type: 'FeatureCollection',
    name: 'surface_zones_generated_for_krasnoyarsk_water_area',
    features: [
      polygonFeature('zone_ice_yenisei_krasnoyarsk', 'ice', 'Енисей и Красноярское водохранилище / лед', [
        [91.840, 55.955],
        [92.020, 55.972],
        [92.205, 55.982],
        [92.395, 55.976],
        [92.575, 55.990],
        [92.745, 56.018],
        [92.950, 56.046],
        [93.185, 56.060],
        [93.190, 56.000],
        [93.030, 55.990],
        [92.835, 55.968],
        [92.635, 55.946],
        [92.420, 55.920],
        [92.225, 55.902],
        [92.030, 55.890],
        [91.845, 55.878],
        [91.840, 55.955]
      ], 'generated_base_krasnoyarsk_water_area'),
      polygonFeature('zone_open_water_city', 'water', 'Открытая вода Енисея в городской части', [
        [92.520, 55.985],
        [92.710, 56.018],
        [92.965, 56.045],
        [93.175, 56.052],
        [93.178, 56.020],
        [92.975, 56.010],
        [92.760, 55.988],
        [92.540, 55.958],
        [92.520, 55.985]
      ]),
      polygonFeature('zone_open_water_hpp_tailrace', 'water', 'Открытая вода ниже КрасГЭС', [
        [92.455, 55.977],
        [92.380, 55.964],
        [92.320, 55.944],
        [92.370, 55.926],
        [92.475, 55.944],
        [92.545, 55.962],
        [92.455, 55.977]
      ]),
      polygonFeature('zone_rocks_hpp', 'rocks', 'Камни / техногенная зона у КрасГЭС', [
        [92.345, 55.952],
        [92.285, 55.944],
        [92.260, 55.920],
        [92.315, 55.904],
        [92.385, 55.923],
        [92.345, 55.952]
      ]),
      polygonFeature('zone_marsh_mana_floodplain', 'marsh', 'Болото / пойма Маны', [
        [92.610, 55.948],
        [92.510, 55.938],
        [92.425, 55.905],
        [92.505, 55.878],
        [92.635, 55.904],
        [92.700, 55.930],
        [92.610, 55.948]
      ]),
      polygonFeature('zone_marsh_city_islands', 'marsh', 'Пойменные острова и заболоченные кромки', [
        [92.880, 56.030],
        [92.775, 56.015],
        [92.735, 55.985],
        [92.845, 55.970],
        [92.955, 55.995],
        [92.880, 56.030]
      ]),
      polygonFeature('zone_slush_reservoir_west', 'slush', 'Шуга / наледь на водохранилище', [
        [92.210, 55.965],
        [92.095, 55.955],
        [92.020, 55.920],
        [92.115, 55.895],
        [92.235, 55.918],
        [92.290, 55.946],
        [92.210, 55.965]
      ]),
      polygonFeature('zone_shallow_biryusa', 'shallow', 'Мелководье залива Бирюса', [
        [92.055, 55.944],
        [91.915, 55.938],
        [91.860, 55.898],
        [91.995, 55.874],
        [92.110, 55.904],
        [92.055, 55.944]
      ]),
      polygonFeature('zone_shallow_city_banks', 'shallow', 'Мелководье у городских берегов', [
        [93.095, 56.050],
        [92.965, 56.035],
        [92.845, 56.005],
        [92.900, 55.980],
        [93.055, 56.000],
        [93.185, 56.022],
        [93.095, 56.050]
      ]),
      polygonFeature('zone_grass_reed_reservoir_banks', 'grass', 'Трава / камыш на береговых кромках', [
        [92.680, 55.972],
        [92.560, 55.958],
        [92.390, 55.925],
        [92.470, 55.895],
        [92.660, 55.916],
        [92.775, 55.948],
        [92.680, 55.972]
      ]),
      polygonFeature('zone_rocks_city_channel', 'rocks', 'Каменистые участки в городской протоке', [
        [92.960, 56.022],
        [92.880, 56.012],
        [92.845, 55.986],
        [92.930, 55.976],
        [93.010, 55.998],
        [92.960, 56.022]
      ])
    ]
  };
}

function normalizeZones(scenario) {
  const osmZones = createZonesFromOsm(scenario);
  if (osmZones) return osmZones;

  if (!Array.isArray(scenario.map?.zones) || scenario.map.zones.length === 0) {
    return createDefaultSurfaceZones();
  }
  return {
    type: 'FeatureCollection',
    name: 'surface_zones_from_user_json',
    features: scenario.map.zones.map((zone, index) => polygonFeature(
      zone.id || `zone_${index + 1}`,
      zone.surface,
      zone.label || zone.surface,
      zone.coordinates,
      zone.source || 'user_json_zone'
    ))
  };
}

function buildWaterwayGraph(scenario, barriers, projection) {
  if (!fs.existsSync(osmWaterwaysPath)) {
    return { nodes: [], nodeCoordinates: {}, edges: [], stats: { source: null, features: 0, nodes: 0, edges: 0 } };
  }
  const osm = JSON.parse(fs.readFileSync(osmWaterwaysPath, 'utf8'));
  const nodes = [];
  const nodeCoordinates = {};
  const edges = [];
  const seen = new Set();
  const typeCounts = {};

  for (const element of osm.elements || []) {
    const surface = waterwaySurface(element.tags);
    if (!surface || !scenario.surfaces?.[surface] || !Array.isArray(element.geometry)) continue;
    const rawPoints = element.geometry.map((point) => ({ lat: point.lat, lon: point.lon }));
    const points = densifyLine(rawPoints, waterwayNodeSpacingKm);
    const label = element.tags?.['name:ru'] || element.tags?.name || element.tags?.waterway || 'waterway';
    typeCounts[element.tags?.waterway || 'waterway'] = (typeCounts[element.tags?.waterway || 'waterway'] || 0) + 1;

    let prevId = null;
    points.forEach((point, index) => {
      const id = `w_${element.id}_${index}`;
      nodes.push({ id, lat: point.lat, lon: point.lon, surface, source: 'osm_waterway_line' });
      nodeCoordinates[id] = {
        lat: point.lat,
        lon: point.lon,
        source: `OSM waterway ${label}`,
        surface
      };
      if (prevId) {
        const from = nodeCoordinates[prevId];
        const edgeKey = [prevId, id].sort().join('__');
        if (!seen.has(edgeKey) && !segmentBlockedByBarrier(from, point, barriers, projection)) {
          seen.add(edgeKey);
          edges.push({
            from: prevId,
            to: id,
            km: Number(haversineKm(from, point).toFixed(3)),
            surface,
            source: 'osm_waterway_line'
          });
        }
      }
      prevId = id;
    });
  }

  return {
    nodes,
    nodeCoordinates,
    edges,
    stats: {
      source: 'OpenStreetMap Overpass API waterway lines',
      osm_base_timestamp: osm.osm3s?.timestamp_osm_base || null,
      features: Object.values(typeCounts).reduce((sum, count) => sum + count, 0),
      typeCounts,
      nodes: nodes.length,
      edges: edges.length,
      spacing_km: waterwayNodeSpacingKm
    }
  };
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygonRings(point, rings) {
  if (!rings?.length || !pointInRing(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(point, rings[i])) return false;
  }
  return true;
}

function surfaceAt(lon, lat, zones) {
  let found = null;
  for (const feature of zones.features) {
    if (feature.geometry?.type !== 'Polygon') continue;
    const rings = feature.geometry.coordinates || [];
    if (!rings.length) continue;
    if (feature.bbox) {
      const [minLon, minLat, maxLon, maxLat] = feature.bbox;
      if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
    }
    if (pointInPolygonRings([lon, lat], rings)) found = feature.properties.surface;
  }
  return found;
}

function projectionForBounds(bounds) {
  const latKm = 111.32;
  const centerLat = (bounds.south + bounds.north) / 2;
  const lonKm = 111.32 * Math.cos((centerLat * Math.PI) / 180);
  return {
    latKm,
    lonKm,
    widthKm: (bounds.east - bounds.west) * lonKm,
    heightKm: (bounds.north - bounds.south) * latKm,
    toXY(point) {
      return {
        x: (point.lon - bounds.west) * lonKm,
        y: (point.lat - bounds.south) * latKm
      };
    },
    toGeo(point) {
      return {
        lat: bounds.south + point.y / latKm,
        lon: bounds.west + point.x / lonKm
      };
    }
  };
}

function distancePointToSegmentKm(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function ccw(a, b, c) {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a, b, c, d) {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

function distanceSegmentToSegmentKm(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distancePointToSegmentKm(a, c, d),
    distancePointToSegmentKm(b, c, d),
    distancePointToSegmentKm(c, a, b),
    distancePointToSegmentKm(d, a, b)
  );
}

function loadBarrierLines(projection) {
  const barriers = [{
    id: 'manual_kras_hpp_no_crossing',
    label: 'КрасГЭС / непроходимая плотина',
    buffer_km: 0.85,
    source: 'manual_safety_barrier',
    points: [
      projection.toXY({ lon: 92.265, lat: 55.949 }),
      projection.toXY({ lon: 92.306, lat: 55.922 })
    ]
  }];

  if (!fs.existsSync(osmBarriersPath)) return barriers;
  try {
    const osm = JSON.parse(fs.readFileSync(osmBarriersPath, 'utf8'));
    for (const element of osm.elements || []) {
      if (!Array.isArray(element.geometry) || element.geometry.length < 2) continue;
      const tags = element.tags || {};
      const label = tags.name || tags.man_made || tags.waterway || 'OSM barrier';
      barriers.push({
        id: `osm_barrier_${element.type}_${element.id}`,
        label,
        buffer_km: 0.35,
        source: 'openstreetmap_overpass_barrier',
        points: element.geometry.map((point) => projection.toXY({ lon: point.lon, lat: point.lat }))
      });
    }
  } catch (_) {
    // Keep the manual safety barrier when Overpass returns HTML/rate-limit text.
  }
  return barriers;
}

function segmentBlockedByBarrier(a, b, barriers, projection) {
  const from = projection.toXY(a);
  const to = projection.toXY(b);
  for (const barrier of barriers) {
    for (let i = 1; i < barrier.points.length; i++) {
      if (distanceSegmentToSegmentKm(from, to, barrier.points[i - 1], barrier.points[i]) <= barrier.buffer_km) {
        return barrier;
      }
    }
  }
  return null;
}

function edgeSurfaceAlong(a, b, zones) {
  const samples = [0.25, 0.5, 0.75];
  let surface = null;
  for (const t of samples) {
    const point = interpolateGeoPoint(a, b, t);
    const found = surfaceAt(point.lon, point.lat, zones);
    if (!found) return null;
    surface = found;
  }
  return surface;
}

function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const point of ring || []) {
    x += point[0];
    y += point[1];
    count += 1;
  }
  if (!count) return null;
  return { lon: x / count, lat: y / count };
}

function buildGraphFromZones(zones, scenario) {
  const projection = projectionForBounds(graphBounds);
  const barriers = loadBarrierLines(projection);
  const sideKm = triangularMesh.side_km;
  const rowStepKm = sideKm * Math.sqrt(3) / 2;
  const rows = Math.floor(projection.heightKm / rowStepKm) + 1;
  const cols = Math.floor(projection.widthKm / sideKm) + 2;
  const meshNodes = [];
  const nodeMap = new Map();
  const nodeCoordinates = {};

  for (let r = 0; r < rows; r++) {
    const y = r * rowStepKm;
    const offset = (r % 2) * sideKm / 2;
    for (let c = 0; c < cols; c++) {
      const x = c * sideKm + offset;
      if (x > projection.widthKm) continue;
      const { lat, lon } = projection.toGeo({ x, y });
      const surface = surfaceAt(lon, lat, zones);
      if (!surface || !scenario.surfaces?.[surface]) continue;
      const id = `t_${r}_${c}`;
      const node = { id, row: r, col: c, lat, lon, surface };
      meshNodes.push(node);
      nodeMap.set(`${r}:${c}`, node);
      nodeCoordinates[id] = { lat, lon, source: 'adaptive_triangular_navmesh', surface };
    }
  }

  const edges = [];
  const seen = new Set();
  const triangleKeys = new Set();

  function addEdge(fromNode, toNode, source = 'adaptive_triangular_navmesh') {
    if (!fromNode || !toNode) return false;
    if (segmentBlockedByBarrier(fromNode, toNode, barriers, projection)) return false;
    const surface = edgeSurfaceAlong(fromNode, toNode, zones);
    if (!surface || !scenario.surfaces?.[surface]) return false;
    const key = [fromNode.id, toNode.id].sort().join('__');
    if (seen.has(key)) return true;
    seen.add(key);
    edges.push({
      from: fromNode.id,
      to: toNode.id,
      km: Number(haversineKm(fromNode, toNode).toFixed(3)),
      surface,
      source
    });
    return true;
  }

  function addTriangle(a, b, c) {
    if (!a || !b || !c) return;
    const centroid = {
      lon: (a.lon + b.lon + c.lon) / 3,
      lat: (a.lat + b.lat + c.lat) / 3
    };
    if (!surfaceAt(centroid.lon, centroid.lat, zones)) return;
    const key = [a.id, b.id, c.id].sort().join('__');
    triangleKeys.add(key);
  }

  for (const node of meshNodes) {
    addEdge(node, nodeMap.get(`${node.row}:${node.col + 1}`));
    if (node.row % 2 === 0) {
      const lowerRight = nodeMap.get(`${node.row + 1}:${node.col}`);
      const lowerLeft = nodeMap.get(`${node.row + 1}:${node.col - 1}`);
      addEdge(node, lowerRight);
      addEdge(node, lowerLeft);
      addTriangle(node, nodeMap.get(`${node.row}:${node.col + 1}`), lowerRight);
      addTriangle(node, lowerLeft, lowerRight);
    } else {
      const lowerLeft = nodeMap.get(`${node.row + 1}:${node.col}`);
      const lowerRight = nodeMap.get(`${node.row + 1}:${node.col + 1}`);
      addEdge(node, lowerLeft);
      addEdge(node, lowerRight);
      addTriangle(node, lowerLeft, lowerRight);
      addTriangle(node, nodeMap.get(`${node.row}:${node.col + 1}`), lowerRight);
    }
  }

  let microTriangleCount = 0;
  zones.features.forEach((feature, index) => {
    const surface = feature.properties?.surface;
    if (!surface || !scenario.surfaces?.[surface] || scenario.surfaces[surface].hard) return;
    const [minLon, minLat, maxLon, maxLat] = feature.bbox || [];
    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return;
    const minXY = projection.toXY({ lon: minLon, lat: minLat });
    const maxXY = projection.toXY({ lon: maxLon, lat: maxLat });
    const widthKm = Math.abs(maxXY.x - minXY.x);
    const heightKm = Math.abs(maxXY.y - minXY.y);
    if (Math.max(widthKm, heightKm) > smallWaterBodyMaxKm) return;
    const rings = feature.geometry?.coordinates || [];
    const center = ringCentroid(rings[0]);
    if (!center || !pointInPolygonRings([center.lon, center.lat], rings)) return;

    const centerXY = projection.toXY(center);
    const radiusKm = smallWaterBodyMicroTriangleKm / Math.sqrt(3);
    const points = [0, 1, 2].map((i) => {
      const angle = -Math.PI / 2 + i * (2 * Math.PI / 3);
      return projection.toGeo({
        x: centerXY.x + Math.cos(angle) * radiusKm,
        y: centerXY.y + Math.sin(angle) * radiusKm
      });
    });
    if (!points.every((point) => pointInPolygonRings([point.lon, point.lat], rings))) return;

    const microNodes = points.map((point, pointIndex) => {
      const id = `m_${index}_${pointIndex}`;
      const node = { id, lat: point.lat, lon: point.lon, surface };
      meshNodes.push(node);
      nodeCoordinates[id] = { lat: point.lat, lon: point.lon, source: 'small_waterbody_micro_triangle', surface };
      return node;
    });
    addEdge(microNodes[0], microNodes[1], 'small_waterbody_micro_triangle');
    addEdge(microNodes[1], microNodes[2], 'small_waterbody_micro_triangle');
    addEdge(microNodes[2], microNodes[0], 'small_waterbody_micro_triangle');
    addTriangle(microNodes[0], microNodes[1], microNodes[2]);
    microTriangleCount += 1;
  });

  const waterwayGraph = buildWaterwayGraph(scenario, barriers, projection);
  for (const node of waterwayGraph.nodes) {
    nodeCoordinates[node.id] = waterwayGraph.nodeCoordinates[node.id];
  }
  edges.push(...waterwayGraph.edges);

  const passableGridNodes = meshNodes.filter((node) => !scenario.surfaces?.[node.surface]?.hard);
  for (const waterwayNode of waterwayGraph.nodes) {
    const nearest = passableGridNodes
      .map((node) => ({ node, distance: haversineKm(waterwayNode, node) }))
      .filter((item) => item.distance <= waterwayGridConnectorKm)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2);
    for (const item of nearest) {
      const key = [waterwayNode.id, item.node.id].sort().join('__');
      if (seen.has(key)) continue;
      if (segmentBlockedByBarrier(waterwayNode, item.node, barriers, projection)) continue;
      seen.add(key);
      edges.push({
        from: waterwayNode.id,
        to: item.node.id,
        km: Number(item.distance.toFixed(3)),
        surface: waterwayNode.surface,
        source: 'osm_waterway_to_surface_grid'
      });
    }
  }

  const routeNodes = [...meshNodes, ...waterwayGraph.nodes];
  const anchorNodes = [];
  for (const [name, coord] of Object.entries(anchorCoordinates)) {
    const surface = surfaceAt(coord.lon, coord.lat, zones) || 'ice';
    nodeCoordinates[name] = { ...coord, surface, source: coord.source };
    anchorNodes.push(name);
    const passableNodes = routeNodes.filter((node) => !scenario.surfaces?.[node.surface]?.hard);
    const nearest = (passableNodes.length ? passableNodes : routeNodes)
      .map((node) => ({ node, distance: haversineKm(coord, node) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 6);
    for (const item of nearest) {
      if (segmentBlockedByBarrier(coord, item.node, barriers, projection)) continue;
      const midpointSurface = surfaceAt((coord.lon + item.node.lon) / 2, (coord.lat + item.node.lat) / 2, zones);
      const edgeSurface = scenario.surfaces?.[midpointSurface]?.hard ? item.node.surface : (midpointSurface || item.node.surface);
      edges.push({
        from: name,
        to: item.node.id,
        km: Number(item.distance.toFixed(3)),
        surface: edgeSurface,
        source: 'anchor_to_navmesh'
      });
    }
  }

  return {
    nodes: [...anchorNodes, ...routeNodes.map((node) => node.id)],
    pickableNodes: anchorNodes,
    nodeCoordinates,
    edges,
    waterwayGraphStats: waterwayGraph.stats,
    meshStats: {
      type: 'adaptive_triangular_navmesh',
      side_km: sideKm,
      rows,
      cols,
      nodes: meshNodes.length,
      edges: edges.filter((edge) => edge.source === 'adaptive_triangular_navmesh').length,
      triangles: triangleKeys.size,
      micro_triangles: microTriangleCount,
      small_waterbody_max_km: smallWaterBodyMaxKm
    },
    barrierStats: {
      count: barriers.length,
      labels: barriers.map((barrier) => barrier.label),
      manual_safety_barrier: barriers.some((barrier) => barrier.source === 'manual_safety_barrier')
    }
  };
}

function buildRouteGeoJson(edges, coordinates, scenario) {
  const features = [];
  for (const edge of edges) {
    const from = coordinates[edge.from];
    const to = coordinates[edge.to];
    if (!from || !to) continue;
    const surface = scenario.surfaces?.[edge.surface] || {};
    features.push({
      type: 'Feature',
      id: `${edge.from}_${edge.to}_${edge.surface}`,
      properties: {
        kind: 'graph_edge',
        from: edge.from,
        to: edge.to,
        km: edge.km,
        surface: edge.surface,
        surface_label: surface.label || edge.surface,
        speed_kmh: surface.spd ?? null,
        risk: surface.risk ?? null,
        k_surf: surface.k_surf ?? null,
        hard: Boolean(surface.hard),
        planing: Boolean(surface.planing),
        source: edge.source || 'auto_grid_graph',
        navigation_grade: false
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [from.lon, from.lat],
          [to.lon, to.lat]
        ]
      }
    });
  }
  for (const [node, coord] of Object.entries(coordinates)) {
    features.push({
      type: 'Feature',
      id: `node_${node}`,
      properties: {
        kind: 'graph_node',
        name: node,
        surface: coord.surface,
        source: coord.source,
        navigation_grade: false
      },
      geometry: {
        type: 'Point',
        coordinates: [coord.lon, coord.lat]
      }
    });
  }
  return {
    type: 'FeatureCollection',
    name: 'adaptive_triangular_navmesh_from_osm_surface_zones',
    features
  };
}

function buildSurfaceStats(edges, scenario) {
  const stats = {};
  for (const [id, surface] of Object.entries(scenario.surfaces || {})) {
    stats[id] = {
      id,
      label: surface.label || id,
      speed_kmh: surface.spd ?? null,
      k_surf: surface.k_surf ?? null,
      risk: surface.risk ?? null,
      planing: Boolean(surface.planing),
      hard: Boolean(surface.hard),
      edge_count: 0,
      total_km: 0
    };
  }
  for (const edge of edges) {
    if (!stats[edge.surface]) continue;
    stats[edge.surface].edge_count += 1;
    stats[edge.surface].total_km += Number(edge.km || 0);
  }
  return stats;
}

function main() {
  ensureDir(outDir);
  const scenario = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const testEdges = scenario.map?.edges || [];
  const runtimeScenario = JSON.parse(JSON.stringify(scenario));
  if (runtimeScenario.map?.edges) runtimeScenario.map.edges = [];
  const zones = normalizeZones(scenario);
  const graph = buildGraphFromZones(zones, scenario);
  const requestedStart = scenario.map?.nodes_start || scenario.scenario?.start || graph.pickableNodes[0];
  const requestedFinish = scenario.map?.nodes_finish || scenario.scenario?.finish || graph.pickableNodes[1];
  const start = requestedStart;
  const finish = zones.name === 'surface_zones_from_openstreetmap_overpass' && requestedFinish === 'Бирюса'
    ? 'Красноярск'
    : requestedFinish;

  fs.writeFileSync(rawOut, `${JSON.stringify(runtimeScenario, null, 2)}\n`, 'utf8');
  fs.writeFileSync(zonesOut, `${JSON.stringify(zones, null, 2)}\n`, 'utf8');

  const lines = [];
  lines.push(pipeLine(['SCENARIO', scenario.scenario?.name || 'Scenario', workingAreaLabel, start, finish]));
  lines.push(pipeLine(['BOAT', scenario.boat?.base_l_per_km ?? 0.8, scenario.boat?.tank_l ?? 370, scenario.boat?.reserve_frac_tank ?? 0.2]));

  for (const [name, cfg] of Object.entries(scenario.configs || {})) {
    lines.push(pipeLine(['CONFIG', name, cfg.k_load ?? 1, cfg.allow_hard ? 1 : 0]));
  }

  for (const [id, surface] of Object.entries(scenario.surfaces || {})) {
    lines.push(pipeLine([
      'SURFACE',
      id,
      surface.label || id,
      surface.spd ?? 1,
      surface.k_surf ?? 1,
      surface.risk ?? 1,
      surface.planing ? 1 : 0,
      surface.hard ? 1 : 0
    ]));
  }

  for (const [name, mode] of Object.entries(scenario.modes || {})) {
    lines.push(pipeLine(['MODE', name, mode.obj || 'time', mode.k_mode ?? 1, mode.desc || '']));
  }

  for (const [node, coord] of Object.entries(graph.nodeCoordinates)) {
    lines.push(pipeLine(['NODE', node, coord.lat, coord.lon]));
  }

  for (const edge of graph.edges) {
    lines.push(pipeLine(['EDGE', edge.from, edge.to, edge.km, edge.surface, edge.source || 'auto_grid_graph']));
  }

  fs.writeFileSync(routeOut, `${lines.join('\n')}\n`, 'utf8');

  const routeGraphGeojson = buildRouteGeoJson(graph.edges, graph.nodeCoordinates, scenario);
  fs.writeFileSync(graphOut, `${JSON.stringify(routeGraphGeojson, null, 2)}\n`, 'utf8');

  const meta = {
    imported_at: new Date().toISOString(),
    source_path: sourcePath,
    raw_json_path: path.relative(root, rawOut),
    route_data_path: path.relative(root, routeOut),
    route_graph_geojson_path: path.relative(root, graphOut),
    surface_zones_geojson_path: path.relative(root, zonesOut),
    scenario: scenario.scenario,
    formulas: scenario.formulas,
    start,
    finish,
    requestedStart,
    requestedFinish,
    nodes: graph.nodes,
    pickableNodes: graph.pickableNodes,
    edges: graph.edges,
    ignoredSourceEdgesCount: testEdges.length,
    nodeCoordinates: graph.nodeCoordinates,
    surfaceStats: buildSurfaceStats(graph.edges, scenario),
    graphGeneration: {
      mode: 'adaptive_triangular_navmesh',
      mesh: graph.meshStats,
      bounds: graphBounds,
      waterway_lines: graph.waterwayGraphStats,
      barriers: graph.barrierStats,
      waterway_connector_km: waterwayGridConnectorKm,
      explanation: 'Рабочий граф строится как треугольный navmesh по полигонам surface_zones.geojson с учетом inner-дыр multipolygon и линейных waterway-объектов OSM. Ребра из пользовательского JSON игнорируются и не попадают в runtime-граф.'
    },
    map: {
      provider: 'OpenStreetMap raster tiles via Leaflet + local generated surface zones',
      attribution: '© OpenStreetMap contributors',
      area_label: workingAreaLabel,
      bounds: [
        [graphBounds.south, graphBounds.west],
        [graphBounds.north, graphBounds.east]
      ],
      georeference_notes: [
        'Дивногорск подтвержден через OSM Nominatim.',
        'Финиш привязан к Верхней Бирюсе как ближайшему OSM-объекту для района залива Бирюса.',
        'Для КрасГЭС, Усть-Маны, Красноярска и Острова Отдыха используются ручные seed-точки MVP.',
        zones.properties?.source
          ? `Зоны поверхностей загружены из ${zones.properties.source}, timestamp: ${zones.properties.osm_base_timestamp || 'unknown'}.`
          : 'Зоны поверхностей для текущего JSON сгенерированы из объявленных типов, так как в JSON нет map.zones.'
      ],
      navigation_grade: false
    },
    disclaimers: [
      'Синтетические данные из пользовательского JSON.',
      'Рабочий граф автоматически построен по зонам поверхностей.',
      'Не использовать для реальной навигации.'
    ]
  };
  fs.writeFileSync(metaOut, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  console.log(`Imported ${testEdges.length} test edges from ${sourcePath}`);
  console.log(`Generated graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
  console.log(`Wrote ${path.relative(root, routeOut)}`);
}

main();
