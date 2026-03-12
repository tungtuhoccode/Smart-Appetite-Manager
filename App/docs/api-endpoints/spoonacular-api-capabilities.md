# Spoonacular API Capabilities Summary

Last reviewed: 2026-03-09  
Primary source: https://spoonacular.com/food-api/docs

## 1) Platform Basics

- Authentication:
  - API key in query (`apiKey`) or header (`x-api-key`).
- Quotas:
  - Point-based daily quota per plan.
  - Typical baseline: `1 point + 0.01 points per result` (with endpoint-specific exceptions).
  - Useful response headers:
    - `X-API-Quota-Request`
    - `X-API-Quota-Used`
    - `X-API-Quota-Left`
- Rate limits:
  - Free: 60 requests/minute
  - Starter: 120 requests/minute
  - Cook: 5 requests/second
  - Culinarian: 10 requests/second
  - Chef: 20 requests/second

## 2) Full Feature Catalog by API Category

### Recipes

- Search Recipes
- Search Recipes by Nutrients
- Search Recipes by Ingredients
- Get Recipe Information
- Get Recipe Information Bulk
- Get Similar Recipes
- Get Random Recipes
- Autocomplete Recipe Search
- Taste by ID
- Equipment by ID
- Price Breakdown by ID
- Ingredients by ID
- Nutrition by ID
- Get Analyzed Recipe Instructions
- Extract Recipe from Website
- Analyze Recipe
- Summarize Recipe
- Analyze Recipe Instructions
- Classify Cuisine
- Analyze a Recipe Search Query
- Estimate Nutrition by Dish Name
- Estimate Nutrition from Image

### Ingredients

- Search Ingredients
- Get Ingredient Information
- Compute Ingredient Amount
- Convert Amounts
- Parse Ingredients
- Compute Glycemic Load
- Autocomplete Ingredient Search
- Get Ingredient Substitutes
- Get Ingredient Substitutes by ID

### Products

- Search Grocery Products
- Grocery Products Overview
- Search Grocery Products by UPC
- Get Product Information
- Get Comparable Products
- Autocomplete Product Search
- Classify Grocery Product
- Classify Grocery Product Bulk
- Map Ingredients to Grocery Products

### Menu Items

- Search Menu Items
- Get Menu Item Information
- Autocomplete Menu Item Search

### Meal Planning

- Working with the Meal Planner
- Get Meal Plan Week
- Get Meal Plan Day
- Generate Meal Plan
- Add to Meal Plan
- Clear Meal Plan Day
- Delete from Meal Plan
- Get Meal Plan Templates
- Get Meal Plan Template
- Add Meal Plan Template
- Delete Meal Plan Template
- Get Shopping List
- Add to Shopping List
- Delete from Shopping List
- Generate Shopping List
- Compute Shopping List
- Search Custom Foods
- Connect User

### Wine

- Wine Guide
- Dish Pairing for Wine
- Wine Pairing
- Wine Description
- Wine Recommendation

### Misc

- Search All Food
- Image Classification (File)
- Image Classification (URL)
- Image Analysis (File)
- Image Analysis (URL)
- Search Food Videos
- Quick Answer
- Detect Food in Text
- Search Site Content
- Random Food Joke
- Random Food Trivia
- Talk to Chatbot
- Conversation Suggests

### Guides

- Authentication
- Rate Limiting & Quotas
- Show Images
- List of Ingredients
- Nutrition
- Diet Definitions
- Intolerances
- Equipment
- Cuisines
- Meal Types
- Recipe Sorting Options
- Write a Chatbot
- spoonacular MCP
- Image Classification Categories
- Image Classification Recipe Search Tutorial

### Widgets

- Recipe Nutrition Label Widget
- Recipe Nutrition Label Image
- Recipe Nutrition Widget
- Recipe Nutrition by ID Widget
- Recipe Nutrition by ID Image
- Recipe Taste Widget
- Recipe Taste by ID Widget
- Recipe Taste by ID Image
- Equipment Widget
- Equipment by ID Widget
- Equipment by ID Image
- Ingredients Widget
- Ingredients by ID Widget
- Ingredients by ID Image
- Price Breakdown Widget
- Price Breakdown by ID Widget
- Price Breakdown by ID Image
- Product Nutrition Label Widget
- Product Nutrition Label Image
- Product Nutrition by ID Widget
- Product Nutrition by ID Image
- Menu Item Nutrition Label Widget
- Menu Item Nutrition Label Image
- Menu Item Nutrition by ID Widget
- Menu Item Nutrition by ID Image
- Create Recipe Card
- Get Recipe Card

## 3) High-Value Capabilities for Smart Appetite Manager

- Inventory-aware recipe retrieval:
  - `recipes/findByIngredients`
  - `recipes/complexSearch` with `fillIngredients`, `max-used-ingredients`, `min-missing-ingredients`
- Rich recipe detail and explainability:
  - `recipes/{id}/information` (nutrition, wine pairing, taste data options)
  - `recipes/{id}/analyzedInstructions`
- Recipe understanding and normalization:
  - `recipes/analyze`
  - `recipes/analyzeInstructions`
  - `recipes/queries/analyze`
  - `recipes/cuisine`
- Ingredient intelligence:
  - `recipes/parseIngredients`
  - `recipes/convert`
  - `food/ingredients/substitutes`
  - `food/ingredients/map`
- Nutrition-focused experiences:
  - `recipes/findByNutrients`
  - `recipes/guessNutrition`
  - `recipes/estimateNutrients` (image-based)
- Meal planning and shopping workflows:
  - `users/connect`
  - meal planner + shopping list endpoints
- Discovery extras:
  - food videos, trivia/jokes, chatbot endpoints

## 4) Important Constraints for Product Planning

- Point costs vary by endpoint and optional parameters.
- Image and advanced NLP endpoints can be more expensive (for example, image analysis and quick-answer style calls).
- Some meal planner endpoints are user-scoped and require `Connect User` (`username` + `hash` flow).
- Complex search can become costly when adding nutrition/instruction/information expansions per result.

## 5) Recommended “Use First” Endpoints for Your Recipe Agent

- Tier A (core):
  - `recipes/findByIngredients`
  - `recipes/complexSearch`
  - `recipes/{id}/information`
  - `recipes/{id}/analyzedInstructions`
- Tier B (quality boost):
  - `recipes/parseIngredients`
  - `recipes/convert`
  - `food/ingredients/substitutes`
  - `recipes/queries/analyze`
- Tier C (premium experiences):
  - meal planner + shopping list endpoints
  - image nutrition estimation endpoints
  - wine pairing/video/chatbot endpoints

## Sources

- https://spoonacular.com/food-api/docs
