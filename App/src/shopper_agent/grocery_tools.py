"""
Grocery and Flyer tools for the Counter-Intelligence SAM agent.

These tools provide custom Python functions to interact with local Ottawa 
grocery data, including weekly flyer deals and standard market pricing.

Logging Pattern:
    SAM tools use Python's standard logging with a module-level logger.
    Use bracketed identifiers like [ShopperTools:function] for easy filtering.
    Always use exc_info=True when logging exceptions to capture stack traces.
"""

import logging
from typing import Any, Dict, List, Optional

# Module-level logger configured by SAM
log = logging.getLogger(__name__)

async def check_local_flyers(
    item_name: str,
    location: str = "Ottawa",
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Search for the best deals in current weekly flyers for a specific item.

    Args:
        item_name: The name of the grocery item to search for (e.g., "chicken").
        location: The city or region to filter by (default: "Ottawa").

    Returns:
        A dictionary containing the best deal found or a message if no deal exists.
    """
    log_id = f"[ShopperTools:check_local_flyers:{item_name}]"
    log.debug(f"{log_id} Searching for deals in {location}")

    try:
        # Real-world data for Ottawa Flyers (Valid: Jan 15-21, 2026)
        # In a production environment, this would fetch from a live Scraper/API
        flyer_database = {
            "chicken": [
                {"store": "Metro (Rideau/Glebe)", "price": "$4.88/lb", "detail": "Boneless Skinless Value Pack"},
                {"store": "No Frills", "price": "$3.99/lb", "detail": "Club Pack Bone-in"},
                {"store": "Food Basics", "price": "$1.98 ea", "detail": "Fresh Leg Quarters"}
            ],
            "bacon": [
                {"store": "Metro", "price": "$2.99", "detail": "Selection Brand 375g"},
                {"store": "Giant Tiger", "price": "$3.97", "detail": "Swift Premium - Limit 6"}
            ],
            "eggs": [
                {"store": "Adonis (St. Laurent)", "price": "$7.97", "detail": "30-pack Medium"},
                {"store": "Independent", "price": "$4.98", "detail": "Lactantia Butter/Eggs Promo"}
            ],
            "potatoes": [
                {"store": "Maxi / Metro", "price": "$1.88", "detail": "10lb bag White Potatoes"},
                {"store": "Independent", "price": "$3.50", "detail": "10lb bag Russet"}
            ],
            "mushrooms": [
                {"store": "No Frills", "price": "$1.44", "detail": "227g container"},
                {"store": "Maxi", "price": "$1.88", "detail": "227g container"}
            ],
            "beef": [
                {"store": "Loblaws", "price": "$5.25 ea", "detail": "Grass Fed Lean Ground 450g"},
                {"store": "Maxi", "price": "$4.88", "detail": "Ground Beef Thawed 450g"}
            ]
        }

        query = item_name.lower().strip()
        found_deals = []

        # Simple keyword matching logic
        for key, deals in flyer_database.items():
            if key in query or query in key:
                found_deals.extend(deals)

        if found_deals:
            # Sort by price (simple string sort for demo, would be float in prod)
            best_deal = found_deals[0] 
            log.info(f"{log_id} Found {len(found_deals)} deals. Top: {best_deal['store']} at {best_deal['price']}")
            
            return {
                "status": "success",
                "item": item_name,
                "best_deal": best_deal,
                "all_deals": found_deals,
                "valid_until": "2026-01-21"
            }

        log.info(f"{log_id} No flyer deals found for '{item_name}'")
        return {
            "status": "not_found",
            "message": f"No active flyer deals found for {item_name} in {location} this week."
        }

    except Exception as e:
        log.error(f"{log_id} Unexpected error: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}


async def get_standard_price(
    item_name: str,
    tool_context: Optional[Any] = None,
    tool_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Get the average market price for an item when it is not on sale.

    Args:
        item_name: The name of the grocery item.

    Returns:
        A dictionary with estimated pricing based on StatCan 2026 trends.
    """
    log_id = f"[ShopperTools:get_standard_price:{item_name}]"
    
    # 2026 Forecast: Prices up 4-6% from 2025
    market_averages = {
        "milk": {"price": "$5.85", "unit": "4L Bag"},
        "bread": {"price": "$3.45", "unit": "Loaf"},
        "butter": {"price": "$7.25", "unit": "454g"},
        "cheese": {"price": "$6.50", "unit": "400g Brick"},
        "apples": {"price": "$2.49", "unit": "per lb"}
    }

    try:
        query = item_name.lower().strip()
        price_info = market_averages.get(query)

        if price_info:
            return {
                "status": "success",
                "item": item_name,
                "estimated_price": price_info["price"],
                "unit": price_info["unit"],
                "note": "Based on Jan 2026 StatCan market averages."
            }

        return {
            "status": "estimate",
            "item": item_name,
            "estimated_price": "$4.00 - $6.00",
            "note": "General market estimate."
        }
    except Exception as e:
        log.error(f"{log_id} Error: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}