import logging
import httpx
import asyncio
from typing import Any, Dict, Optional, List

log = logging.getLogger(__name__)

# List of common grocery chains in Ottawa to prioritize and validate
OTTAWA_GROCERS = [
    "metro", "loblaws", "walmart", "real canadian superstore", "farm boy", 
    "freshco", "food basics", "sobeys", "your independent grocer", "adoni", 
    "whole foods", "giant tiger", "costco", "t&t"
]

async def check_local_flyers(
    item_name: str,
    location: str = "Ottawa, Ontario, Canada", 
    limit: int = 5,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Fetches real-time local grocery deals with strict Ottawa-centric filtering."""
    log.info(f"[ShopperTools] Checking flyers for: {item_name}")
    
    api_key = tool_config.get("serpapi_key") if tool_config else None
    if not api_key:
        return {"status": "error", "message": "SerpApi key is missing."}

    # Query specifically for 'flyer' and 'on sale' to trigger local flyer data
    params = {
        "engine": "google_shopping",
        "q": f"{item_name} flyer sale", # Try precise query first
        "location": location,
        "gl": "ca",          
        "hl": "en",          
        "on_sale": "1",      
        "num": "20",       
        "api_key": api_key
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get("https://serpapi.com/search.json", params=params)
             
            # If the specific location failed, try falling back
            if resp.status_code != 200 and location != "Ottawa, Ontario, Canada":
                 params["location"] = "Ottawa, Ontario, Canada"
                 resp = await client.get("https://serpapi.com/search.json", params=params)

            resp.raise_for_status()
            results = resp.json().get("shopping_results", [])
            
            # FALLBACK: If strict flyer search yielded nothing, try broad local search
            if not results:
                log.info(f"[ShopperTools] No strict flyer deals for {item_name}. Retrying with broad local search...")
                params["on_sale"] = "0" # Remove sale filter
                params["q"] = item_name # Remove 'flyer' keyword to get general inventory
                resp = await client.get("https://serpapi.com/search.json", params=params)
                resp.raise_for_status()
                results = resp.json().get("shopping_results", [])

        if not results:
            return {"status": "not_found", "message": f"No sales found for {item_name}."}

        def is_valid_deal(deal):
            source = deal.get("source", "").lower()
            title = deal.get("title", "").lower()
            
            # 1. Broad online/non-local blocklist
            blocked_sources = [
                "alibaba", "aliexpress", "ebay", "etsy", "amazon", "temu", "ubuy", 
                "wayfair", "spud.ca", "well.ca", "staples", "snapklik", "floral acres",
                "save-on-foods", "t&t" 
            ]
            if any(blocked in source for blocked in blocked_sources):
                return False

            # 2. Block non-food/specialty keywords
            blocked_keywords = [
                "plant", "seed", "tree", "wholesale", "bulk 1000kg", "dried", 
                "powder", "extract", "artificial", "chocolate covered", "toy"
            ]
            if any(keyword in title for keyword in blocked_keywords):
                return False
                
            return True

        deals_found = []
        for deal in results:
            if len(deals_found) >= limit: break
            if is_valid_deal(deal):
                # CLEANUP: Remove .ca/.com from store names for display
                raw_store = deal.get("source", "")
                clean_store = raw_store.replace(".ca", "").replace(".com", "").strip()
                
                deals_found.append({
                    "store": clean_store,
                    "price": deal.get("price"),
                    "item": deal.get("title"),
                    "link": deal.get("product_link"),
                    "snippet": deal.get("snippet", "") # Pass description to help find Quantity
                })
            
        return {"status": "success", "deals": deals_found}

    except Exception as e:
        log.error(f"[ShopperTools] API failure: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}

async def get_standard_price(
    item_name: str,
    location: str = "Ottawa, Ontario, Canada",
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Fetches key injected from YAML for standard price lookup."""
    log.info(f"[ShopperTools] Checking standard price for: {item_name}")
    api_key = tool_config.get("serpapi_key") if tool_config else None
    if not api_key:
        return {"status": "error", "message": "SerpApi key is missing."}

    # Configure the search parameters (no sale filter)
    params = {
        "engine": "google_shopping",
        "q": f"{item_name} grocery",
        "location": location,
        "gl": "ca",
        "hl": "en",
        "api_key": api_key
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get("https://serpapi.com/search.json", params=params)
            resp.raise_for_status()
            results = resp.json().get("shopping_results", [])

        if not results:
            return {"status": "not_found", "message": f"No standard price found for {item_name}."}

        # Use the first result as a baseline
        baseline = results[0]
        return {
            "status": "success",
            "average_price": baseline.get("price"),
            "item": baseline.get("title"),
            "source": "Google Shopping Estimate"
        }

    except Exception as e:
        log.error(f"[ShopperTools] Standard Price Check failed: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}

async def find_nearest_store_address(
    store_name: str,
    location: str,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Finds the address and ensures it is actually in Ottawa."""
    api_key = tool_config.get("serpapi_key") if tool_config else None
    if not api_key: return None
    
    params = {
        "engine": "google_maps",
        "q": f"{store_name} near {location}",
        "type": "search",
        "api_key": api_key
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get("https://serpapi.com/search.json", params=params)
            data = resp.json()
            local_results = data.get("local_results", [])
            
            if local_results:
                address = local_results[0].get("address", "")
                
                # RELAXED LOCATION FILTER: Check for Ottawa and surrounding areas
                accepted_cities = ["ottawa", "nepean", "kanata", "gloucester", "orleans", "vanier", "barrhaven", "stittsville", "gatineau"]
                address_lower = address.lower()
                
                if any(city in address_lower for city in accepted_cities):
                    return address
                    
    except Exception as e:
        log.warning(f"[ShopperTools] Address lookup failed: {e}")
    return None

async def find_best_deals_batch(
    items: List[str],
    location: str = "Ottawa, Ontario, Canada",
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Orchestrates batch search with strict geographical verification."""
    results = {}
    address_cache = {}
    
    for item in items:
        response = await check_local_flyers(item, location, limit=5, tool_config=tool_config)
        
        if response.get("status") == "success":
            enriched_deals = []
            for deal in response.get("deals", []):
                store_name = deal.get("store")
                
                if store_name in address_cache:
                    address = address_cache[store_name]
                else:
                    address = await find_nearest_store_address(store_name, location, tool_config)
                    address_cache[store_name] = address

                # ONLY include deals with a verified Ottawa address
                if address:
                    enriched_deals.append({
                        "store": store_name,
                        "address": address,
                        "price": deal.get("price"),
                        "item_title": deal.get("item"),
                        "link": deal.get("product_link")
                    })

            if enriched_deals:
                results[item] = {"found": True, "options": enriched_deals}
            else:
                results[item] = {"found": False, "note": "No verified local Ottawa deals found."}
        else:
            results[item] = {"found": False, "note": "No flyer deals found."}

    return {"status": "success", "summary": results, "location_used": location}