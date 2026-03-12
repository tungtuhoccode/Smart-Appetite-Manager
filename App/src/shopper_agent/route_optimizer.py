import logging
import httpx
import asyncio
import math
import os
import sentry_sdk
from sentry_sdk import trace, set_tag
from itertools import combinations
from typing import Any, Dict, List, Optional, Tuple

log = logging.getLogger(__name__)

FLIPP_SEARCH_URL = "https://backflipp.wishabi.com/flipp/items/search"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"

# Shared geocode cache
_geocode_cache: Dict[str, Optional[Dict[str, float]]] = {}

# Default weights for the scoring algorithm
DEFAULT_WEIGHTS = {
    "price": 0.35,
    "convenience": 0.25,
    "coverage": 0.25,
    "distance": 0.15,
}


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate the great-circle distance between two points in km."""
    R = 6371.0
    rlat1, rlng1, rlat2, rlng2 = map(math.radians, [lat1, lng1, lat2, lng2])
    dlat = rlat2 - rlat1
    dlng = rlng2 - rlng1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _total_route_distance(
    store_coords: Dict[str, Dict[str, float]],
    store_names: List[str],
    home_lat: float,
    home_lng: float,
) -> float:
    """Calculate total travel distance for a route: home -> stores -> home.

    Uses nearest-neighbor ordering to approximate the shortest path.
    """
    if not store_names:
        return 0.0

    valid = [s for s in store_names if s in store_coords]
    if not valid:
        return 0.0

    # Nearest-neighbor TSP approximation starting from home
    visited = []
    current_lat, current_lng = home_lat, home_lng
    remaining = list(valid)

    while remaining:
        nearest = min(
            remaining,
            key=lambda s: _haversine_km(current_lat, current_lng, store_coords[s]["lat"], store_coords[s]["lng"]),
        )
        remaining.remove(nearest)
        visited.append(nearest)
        current_lat = store_coords[nearest]["lat"]
        current_lng = store_coords[nearest]["lng"]

    # Sum: home -> first -> ... -> last -> home
    total = 0.0
    prev_lat, prev_lng = home_lat, home_lng
    for store in visited:
        total += _haversine_km(prev_lat, prev_lng, store_coords[store]["lat"], store_coords[store]["lng"])
        prev_lat = store_coords[store]["lat"]
        prev_lng = store_coords[store]["lng"]
    total += _haversine_km(prev_lat, prev_lng, home_lat, home_lng)

    return total


def _build_store_item_matrix(
    all_deals: Dict[str, List[Dict[str, Any]]],
) -> Tuple[Dict[str, Dict[str, Dict[str, Any]]], List[str], List[str]]:
    """Build a matrix: store -> item -> best deal info.

    Returns (matrix, list of all stores, list of all items).
    """
    matrix: Dict[str, Dict[str, Dict[str, Any]]] = {}
    all_stores = set()
    all_items = list(all_deals.keys())

    for item_name, deals in all_deals.items():
        for deal in deals:
            store = deal["store"]
            all_stores.add(store)
            price_val = 0.0
            try:
                price_val = float(deal.get("price", "$0").replace("$", "").split()[0])
            except (ValueError, IndexError):
                pass

            if store not in matrix:
                matrix[store] = {}

            # Keep the cheapest deal per store per item
            if item_name not in matrix[store] or price_val < matrix[store][item_name].get("price_val", float("inf")):
                matrix[store][item_name] = {
                    "price": deal["price"],
                    "price_val": price_val,
                    "sale_story": deal.get("sale_story", ""),
                    "valid_to": deal.get("valid_to", ""),
                    "item_desc": deal.get("item", item_name),
                }

    return matrix, sorted(all_stores), all_items


def _generate_candidate_routes(
    matrix: Dict[str, Dict[str, Dict[str, Any]]],
    all_stores: List[str],
    all_items: List[str],
) -> List[Dict[str, Any]]:
    """Generate candidate shopping routes (store combinations).

    Strategy:
    1. Single-store routes
    2. All 2-store combinations
    3. All 3-store combinations (capped at 15 stores)
    4. Greedy set-cover route
    """
    candidates = []

    def _evaluate_combo(stores: List[str]) -> Dict[str, Any]:
        covered_items = {}
        for item in all_items:
            best_price = float("inf")
            best_store = None
            best_deal = None
            for store in stores:
                if store in matrix and item in matrix[store]:
                    deal = matrix[store][item]
                    if deal["price_val"] < best_price or (deal["price_val"] == 0 and best_price == float("inf")):
                        best_price = deal["price_val"]
                        best_store = store
                        best_deal = deal
            if best_deal:
                covered_items[item] = {
                    "store": best_store,
                    "price": best_deal["price"],
                    "price_val": best_price,
                    "sale_story": best_deal["sale_story"],
                }

        total_cost = sum(d["price_val"] for d in covered_items.values())

        return {
            "stores": list(stores),
            "store_count": len(stores),
            "covered_items": covered_items,
            "coverage": len(covered_items) / len(all_items) if all_items else 0.0,
            "total_cost": round(total_cost, 2),
            "missing_items": [i for i in all_items if i not in covered_items],
        }

    # 1-store routes
    for store in all_stores:
        route = _evaluate_combo([store])
        if route["coverage"] > 0:
            candidates.append(route)

    # 2-store combos
    for combo in combinations(all_stores, 2):
        route = _evaluate_combo(list(combo))
        if route["coverage"] > 0:
            candidates.append(route)

    # 3-store combos
    if len(all_stores) <= 15:
        for combo in combinations(all_stores, 3):
            route = _evaluate_combo(list(combo))
            if route["coverage"] > 0:
                candidates.append(route)

    # Greedy set-cover
    uncovered = set(all_items)
    greedy_stores = []
    remaining_stores = set(all_stores)

    while uncovered and remaining_stores:
        best_store = max(
            remaining_stores,
            key=lambda s: len(set(matrix.get(s, {}).keys()) & uncovered),
        )
        newly_covered = set(matrix.get(best_store, {}).keys()) & uncovered
        if not newly_covered:
            break
        greedy_stores.append(best_store)
        uncovered -= newly_covered
        remaining_stores.remove(best_store)

    if greedy_stores:
        route = _evaluate_combo(greedy_stores)
        candidates.append(route)

    return candidates


def _score_routes(
    candidates: List[Dict[str, Any]],
    store_coords: Dict[str, Dict[str, float]],
    home_lat: float,
    home_lng: float,
    weights: Dict[str, float],
) -> List[Dict[str, Any]]:
    """Score and rank candidate routes using weighted multi-factor algorithm.

    Factors (all normalized 0-1, higher = better):
    - price: lower total cost is better
    - convenience: fewer stores is better
    - coverage: more items covered is better
    - distance: shorter total route distance is better
    """
    if not candidates:
        return []

    # Compute route distances
    for route in candidates:
        route["route_distance_km"] = round(
            _total_route_distance(store_coords, route["stores"], home_lat, home_lng), 1
        )

    # Find min/max for normalization
    costs = [r["total_cost"] for r in candidates if r["total_cost"] > 0]
    max_cost = max(costs) if costs else 1.0
    min_cost = min(costs) if costs else 0.0
    cost_range = max_cost - min_cost if max_cost > min_cost else 1.0

    max_stores = max(r["store_count"] for r in candidates)
    min_stores = min(r["store_count"] for r in candidates)
    store_range = max_stores - min_stores if max_stores > min_stores else 1.0

    distances = [r["route_distance_km"] for r in candidates if r["route_distance_km"] > 0]
    max_dist = max(distances) if distances else 1.0
    min_dist = min(distances) if distances else 0.0
    dist_range = max_dist - min_dist if max_dist > min_dist else 1.0

    for route in candidates:
        # Price score: lower cost = higher score
        price_score = 1.0 - ((route["total_cost"] - min_cost) / cost_range) if route["total_cost"] > 0 else 0.5

        # Convenience score: fewer stores = higher score
        conv_score = 1.0 - ((route["store_count"] - min_stores) / store_range)

        # Coverage score: direct fraction
        cov_score = route["coverage"]

        # Distance score: shorter = higher score
        if route["route_distance_km"] > 0:
            dist_score = 1.0 - ((route["route_distance_km"] - min_dist) / dist_range)
        else:
            dist_score = 0.5

        route["scores"] = {
            "price": round(price_score, 3),
            "convenience": round(conv_score, 3),
            "coverage": round(cov_score, 3),
            "distance": round(dist_score, 3),
        }

        route["weighted_score"] = round(
            weights["price"] * price_score
            + weights["convenience"] * conv_score
            + weights["coverage"] * cov_score
            + weights["distance"] * dist_score,
            4,
        )

    candidates.sort(key=lambda r: r["weighted_score"], reverse=True)
    return candidates


async def _geocode_store(
    store_name: str,
    center_lat: float,
    center_lng: float,
    client: httpx.AsyncClient,
) -> Optional[Dict[str, float]]:
    """Geocode a store using Nominatim with a viewbox bounded to ~30km around the center."""
    cache_key = f"{store_name}|{center_lat:.2f},{center_lng:.2f}"
    if cache_key in _geocode_cache:
        return _geocode_cache[cache_key]

    OFFSET = 0.3
    viewbox = f"{center_lng - OFFSET},{center_lat + OFFSET},{center_lng + OFFSET},{center_lat - OFFSET}"

    try:
        params = {
            "q": store_name,
            "format": "json",
            "limit": "1",
            "countrycodes": "ca",
            "viewbox": viewbox,
            "bounded": "1",
        }
        headers = {"User-Agent": "SmartAppetiteManager/1.0 (hackathon project)"}
        resp = await client.get(NOMINATIM_SEARCH_URL, params=params, headers=headers)
        resp.raise_for_status()
        results = resp.json()

        if results:
            coords = {"lat": float(results[0]["lat"]), "lng": float(results[0]["lon"])}
            _geocode_cache[cache_key] = coords
            return coords

    except Exception as e:
        log.warning(f"[RouteOptimizer] Geocode failed for '{store_name}': {e}")

    _geocode_cache[cache_key] = None
    return None


def _parse_flipp_items(raw_items: list, limit: int = 10) -> List[Dict[str, Any]]:
    """Parse raw Flipp API response items into a clean deal format."""
    deals = []
    for item in raw_items:
        if len(deals) >= limit:
            break

        price = item.get("current_price")
        post_price_text = item.get("post_price_text") or ""

        if price is not None:
            display_price = f"${price:.2f}"
            if post_price_text:
                display_price += f" {post_price_text}"
        else:
            display_price = "See flyer"

        store = item.get("merchant_name") or item.get("merchant") or "Unknown Store"

        deals.append({
            "store": store,
            "item": item.get("name") or item.get("description") or "Unknown Item",
            "price": display_price,
            "original_price": f"${item['original_price']:.2f}" if item.get("original_price") else None,
            "sale_story": item.get("sale_story", ""),
            "valid_from": item.get("valid_from", ""),
            "valid_to": item.get("valid_to", ""),
        })

    return deals


@trace
async def plan_optimal_route(
    items: List[str],
    weight_price: float = 0.35,
    weight_convenience: float = 0.25,
    weight_coverage: float = 0.25,
    weight_distance: float = 0.15,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Find the optimal grocery shopping route for a list of items.

    Searches Flipp for deals on all items, then uses a weighted multi-factor
    algorithm to score possible store combinations and route plans.

    Factors considered (weights are adjustable):
    - price: total cost of all items across chosen stores (lower is better)
    - convenience: number of stores to visit (fewer is better)
    - coverage: how many of the requested items are available on sale
    - distance: total travel distance between stores (shorter is better)

    Returns the top 5 scored routes with full breakdown so the LLM can
    analyze and present the best option to the user.
    """
    log_id = f"[RouteOptimizer:plan:{len(items)} items]"
    log.info(f"{log_id} Starting route optimization")

    postal_code = (tool_config.get("postal_code") if tool_config else None) or "K1A 0A6"
    locale = (tool_config.get("locale") if tool_config else None) or "en-us"
    map_center_lat = float(tool_config.get("map_center_lat", 45.4215)) if tool_config else 45.4215
    map_center_lng = float(tool_config.get("map_center_lng", -75.6972)) if tool_config else -75.6972

    weights = {
        "price": weight_price,
        "convenience": weight_convenience,
        "coverage": weight_coverage,
        "distance": weight_distance,
    }

    # Step 1: Fetch deals for all items from Flipp
    all_deals: Dict[str, List[Dict[str, Any]]] = {}
    items_not_found = []

    async with httpx.AsyncClient(timeout=15.0) as client:
        for item in items:
            params = {"locale": locale, "postal_code": postal_code, "q": item}
            try:
                resp = await client.get(FLIPP_SEARCH_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
                raw_items = data.get("items", [])

                if raw_items:
                    deals = _parse_flipp_items(raw_items, limit=10)
                    all_deals[item] = deals
                else:
                    items_not_found.append(item)
            except Exception as e:
                log.warning(f"{log_id} Flipp search failed for '{item}': {e}")
                items_not_found.append(item)

        if not all_deals:
            return {
                "status": "no_deals",
                "message": "No flyer deals found for any of the requested items.",
                "items_searched": items,
            }

        # Step 2: Build store-item matrix
        matrix, all_stores, all_items_found = _build_store_item_matrix(all_deals)
        log.info(f"{log_id} Found {len(all_stores)} stores across {len(all_items_found)} items")

        # Step 3: Generate candidate routes
        candidates = _generate_candidate_routes(matrix, all_stores, all_items_found)
        log.info(f"{log_id} Generated {len(candidates)} candidate routes")

        # Step 4: Geocode stores for distance calculation
        store_coords: Dict[str, Dict[str, float]] = {}
        unique_stores = set()
        for route in candidates:
            unique_stores.update(route["stores"])

        for store_name in unique_stores:
            coords = await _geocode_store(store_name, map_center_lat, map_center_lng, client)
            if coords:
                store_coords[store_name] = coords
            await asyncio.sleep(1.1)  # Nominatim rate limit

    # Step 5: Score and rank routes
    scored_routes = _score_routes(candidates, store_coords, map_center_lat, map_center_lng, weights)

    # Take top 5 unique routes (deduplicate by store set)
    seen_combos = set()
    top_routes = []
    for route in scored_routes:
        combo_key = frozenset(route["stores"])
        if combo_key not in seen_combos:
            seen_combos.add(combo_key)
            store_breakdown = []
            for store in route["stores"]:
                items_at_store = [
                    {
                        "name": item_name,
                        "price": info["price"],
                        "sale_story": info["sale_story"],
                    }
                    for item_name, info in route["covered_items"].items()
                    if info["store"] == store
                ]
                store_total = sum(
                    info["price_val"]
                    for info in route["covered_items"].values()
                    if info["store"] == store
                )
                store_breakdown.append({
                    "store": store,
                    "items": items_at_store,
                    "subtotal": round(store_total, 2),
                    "coords": store_coords.get(store),
                })
            route["store_breakdown"] = store_breakdown
            top_routes.append(route)

        if len(top_routes) >= 5:
            break

    # Build map data for the best route
    best_route = top_routes[0] if top_routes else None
    shopper_map_data = None
    if best_route:
        map_stores = []
        for sb in best_route["store_breakdown"]:
            if sb["coords"]:
                map_stores.append({
                    "store": sb["store"],
                    "lat": sb["coords"]["lat"],
                    "lng": sb["coords"]["lng"],
                    "items": sb["items"],
                    "total": sb["subtotal"],
                    "is_recommended": sb["store"] == best_route["stores"][0],
                })
        shopper_map_data = {
            "stores": map_stores,
            "center": {"lat": map_center_lat, "lng": map_center_lng},
            "recommended_store": best_route["stores"][0] if best_route["stores"] else None,
        }

    # Clean up routes for JSON serialization
    serializable_routes = []
    for route in top_routes:
        serializable_routes.append({
            "rank": len(serializable_routes) + 1,
            "stores": route["stores"],
            "store_count": route["store_count"],
            "total_cost": route["total_cost"],
            "coverage": f"{route['coverage'] * 100:.0f}%",
            "coverage_fraction": route["coverage"],
            "items_covered": len(route["covered_items"]),
            "items_total": len(all_items_found),
            "missing_items": route["missing_items"],
            "route_distance_km": route["route_distance_km"],
            "weighted_score": route["weighted_score"],
            "factor_scores": route["scores"],
            "store_breakdown": route["store_breakdown"],
        })

    return {
        "status": "success",
        "weights_used": weights,
        "items_searched": items,
        "items_with_deals": list(all_deals.keys()),
        "items_not_found": items_not_found,
        "total_stores_found": len(all_stores),
        "routes_evaluated": len(candidates),
        "top_routes": serializable_routes,
        "shopper_map_data": shopper_map_data,
    }
