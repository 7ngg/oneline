# Derive compact statistical priors from ResPlan (CC BY 4.0) for the oneline
# solver. Plans are on a normalized 256x256 canvas; the 'area' field carries
# the flat's real m2, so per-plan scale = sqrt(area_m2 / inner.area) converts
# units to metres. 'net_area' is unreliable and ignored.

import json
import pickle
import sys
from collections import Counter, defaultdict
from math import dist, sqrt
from statistics import median

from shapely.geometry import MultiPolygon, Polygon

PKL = sys.argv[1]
OUT = sys.argv[2]

ROOM_KEYS = ["living", "kitchen", "bedroom", "bathroom", "balcony"]

def geoms(x):
    if x is None:
        return []
    if isinstance(x, Polygon):
        return [] if x.is_empty else [x]
    if isinstance(x, MultiPolygon) or hasattr(x, "geoms"):
        return [g for g in x.geoms if not g.is_empty and isinstance(g, Polygon)]
    return []

def aspect_of(poly):
    rect = poly.minimum_rotated_rectangle
    try:
        coords = list(rect.exterior.coords)[:4]
    except Exception:
        return None
    a = dist(coords[0], coords[1])
    b = dist(coords[1], coords[2])
    if min(a, b) < 1e-6:
        return None
    return max(a, b) / min(a, b)

def pct(values, p):
    if not values:
        return None
    s = sorted(values)
    return s[min(len(s) - 1, max(0, int(round(p * (len(s) - 1)))))]

with open(PKL, "rb") as f:
    plans = pickle.load(f)
print(f"plans: {len(plans)}", file=sys.stderr)

areas = defaultdict(list)
aspects = defaultdict(list)
counts = defaultdict(list)
exterior_frac = defaultdict(list)
share_of_flat = defaultdict(list)
touch = Counter()
touch_possible = Counter()
door_conn = Counter()
entrance = Counter()
flat_areas = []
wall_depths = []
bad = 0

for i, plan in enumerate(plans):
    try:
        if not isinstance(plan, dict):
            bad += 1
            continue
        inner_polys = geoms(plan.get("inner"))
        area_m2 = plan.get("area")
        if not inner_polys or not isinstance(area_m2, float) or area_m2 < 15 or area_m2 > 400:
            bad += 1
            continue
        inner_units2 = sum(p.area for p in inner_polys)
        if inner_units2 <= 0:
            bad += 1
            continue
        scale = sqrt(area_m2 / inner_units2)  # metres per unit
        m = lambda units: units * scale
        u = lambda metres: metres / scale
        flat_areas.append(area_m2)
        wd = plan.get("wall_depth")
        if isinstance(wd, float) and 0.05 < m(wd) < 0.6:
            wall_depths.append(m(wd))

        from shapely.ops import unary_union
        inner_union = unary_union(inner_polys)
        boundary = inner_union.boundary

        rooms = []
        for key in ROOM_KEYS:
            polys = [p for p in geoms(plan.get(key)) if (p.area * scale * scale) >= 0.8]
            counts[key].append(len(polys))
            type_area = 0.0
            for p in polys:
                room_m2 = p.area * scale * scale
                rooms.append((key, p))
                areas[key].append(room_m2)
                asp = aspect_of(p)
                if asp is not None and asp < 20:
                    aspects[key].append(asp)
                contact = p.boundary.buffer(u(0.15)).intersection(boundary)
                exterior_frac[key].append(1.0 if m(contact.length) > 0.8 else 0.0)
                type_area += room_m2
            if type_area > 0:
                share_of_flat[key].append(type_area / area_m2)

        present = set(t for t, _ in rooms)
        for a in ROOM_KEYS:
            for b in ROOM_KEYS:
                if a < b and a in present and b in present:
                    touch_possible[f"{a}|{b}"] += 1
        seen = set()
        buffered = [(t, p, p.buffer(u(0.12))) for t, p in rooms]
        for x in range(len(buffered)):
            for y in range(x + 1, len(buffered)):
                ta, pa, ba = buffered[x]
                tb, pb, bb = buffered[y]
                key = "|".join(sorted((ta, tb)))
                if key in seen:
                    continue
                if ba.intersects(bb) and ba.intersection(bb).area > u(0.3) * u(0.2):
                    touch[key] += 1
                    seen.add(key)

        door_pairs = set()
        for d in geoms(plan.get("door")):
            blob = d.buffer(u(0.1))
            touching = sorted(set(t for t, p in rooms if p.intersects(blob)))
            for ai in range(len(touching)):
                for bi in range(ai + 1, len(touching)):
                    door_pairs.add(f"{touching[ai]}|{touching[bi]}")
        for key in door_pairs:
            door_conn[key] += 1

        fd_polys = geoms(plan.get("front_door"))
        if fd_polys:
            blob = fd_polys[0].buffer(u(0.25))
            best = None
            for t, p in rooms:
                if p.intersects(blob):
                    ov = p.intersection(blob).area
                    if best is None or ov > best[1]:
                        best = (t, ov)
            if best:
                entrance[best[0]] += 1
    except Exception:
        bad += 1
    if i % 2000 == 0:
        print(f"  {i}... used={len(flat_areas)} bad={bad}", file=sys.stderr)

def type_stats(key):
    a = areas[key]
    return {
        "area_m2_p25": round(pct(a, 0.25), 1) if a else None,
        "area_m2_median": round(median(a), 1) if a else None,
        "area_m2_p75": round(pct(a, 0.75), 1) if a else None,
        "area_m2_p90": round(pct(a, 0.90), 1) if a else None,
        "aspect_median": round(median(aspects[key]), 2) if aspects[key] else None,
        "aspect_p90": round(pct(aspects[key], 0.90), 2) if aspects[key] else None,
        "aspect_p98": round(pct(aspects[key], 0.98), 2) if aspects[key] else None,
        "exterior_contact_rate": round(sum(exterior_frac[key]) / len(exterior_frac[key]), 3)
        if exterior_frac[key]
        else None,
        "share_of_flat_median": round(median(share_of_flat[key]), 3) if share_of_flat[key] else None,
        "count_median": median(counts[key]) if counts[key] else 0,
        "samples": len(a),
    }

out = {
    "source": "ResPlan v1 (github.com/m-agour/ResPlan), CC BY 4.0. Derived statistics only.",
    "plans_used": len(flat_areas),
    "plans_skipped": bad,
    "flat_area_m2": {
        "p25": round(pct(flat_areas, 0.25), 1),
        "median": round(median(flat_areas), 1),
        "p75": round(pct(flat_areas, 0.75), 1),
    },
    "wall_depth_m_median": round(median(wall_depths), 3) if wall_depths else None,
    "types": {k: type_stats(k) for k in ROOM_KEYS},
    "pair_touch_rate": {
        k: round(touch[k] / touch_possible[k], 3)
        for k in sorted(touch_possible)
        if touch_possible[k] >= 100
    },
    "pair_door_rate": {k: round(door_conn[k] / touch[k], 3) for k in sorted(touch) if touch[k] >= 100},
    "entrance_room_share": {
        k: round(v / sum(entrance.values()), 3) for k, v in entrance.most_common()
    },
}

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2)
print(json.dumps(out, indent=2))
