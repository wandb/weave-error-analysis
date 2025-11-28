"""
Travel Planner Agent using Google ADK with W&B Weave Instrumentation

This agent helps users plan trips by:
- Suggesting destinations based on preferences
- Creating itineraries
- Providing travel tips and recommendations

Instrumented with W&B Weave for full observability.
"""

import os
from dotenv import load_dotenv
import weave

from google.adk.agents import Agent
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

load_dotenv()

# Initialize Weave for observability
weave.init(os.getenv("WEAVE_PROJECT", "error-analysis-demo"))


# Define tools for the travel planner
@weave.op()
def search_destinations(preferences: str, budget: str) -> dict:
    """
    Search for travel destinations based on user preferences and budget.
    
    Args:
        preferences: User's travel preferences (beach, mountains, city, etc.)
        budget: Budget range (budget, moderate, luxury)
    
    Returns:
        Dictionary with destination recommendations
    """
    # Simulated destination database
    destinations = {
        "beach": {
            "budget": ["Goa, India", "Bali, Indonesia", "Phuket, Thailand"],
            "moderate": ["Cancun, Mexico", "Maldives", "Santorini, Greece"],
            "luxury": ["Bora Bora", "Seychelles", "Amalfi Coast, Italy"]
        },
        "mountains": {
            "budget": ["Himachal Pradesh, India", "Nepal", "Georgia"],
            "moderate": ["Swiss Alps", "Colorado, USA", "Patagonia"],
            "luxury": ["Aspen, USA", "Chamonix, France", "Queenstown, NZ"]
        },
        "city": {
            "budget": ["Bangkok, Thailand", "Lisbon, Portugal", "Prague, Czech Republic"],
            "moderate": ["Barcelona, Spain", "Tokyo, Japan", "New York, USA"],
            "luxury": ["Paris, France", "Dubai, UAE", "Singapore"]
        },
        "adventure": {
            "budget": ["Costa Rica", "Vietnam", "Morocco"],
            "moderate": ["New Zealand", "Iceland", "South Africa"],
            "luxury": ["Antarctica", "Galapagos Islands", "African Safari"]
        }
    }
    
    # Normalize inputs
    pref_lower = preferences.lower()
    budget_lower = budget.lower()
    
    # Find matching category
    matched_category = None
    for category in destinations.keys():
        if category in pref_lower:
            matched_category = category
            break
    
    if not matched_category:
        matched_category = "city"  # Default to city
    
    # Find matching budget
    if "budget" in budget_lower or "cheap" in budget_lower:
        budget_key = "budget"
    elif "luxury" in budget_lower or "expensive" in budget_lower:
        budget_key = "luxury"
    else:
        budget_key = "moderate"
    
    return {
        "category": matched_category,
        "budget_level": budget_key,
        "destinations": destinations[matched_category][budget_key],
        "note": f"Found {len(destinations[matched_category][budget_key])} destinations matching your criteria"
    }


@weave.op()
def get_weather_info(destination: str, month: str) -> dict:
    """
    Get weather information for a destination during a specific month.
    
    Args:
        destination: The travel destination
        month: Month of travel
    
    Returns:
        Weather information dictionary
    """
    # Simulated weather data
    weather_data = {
        "january": {"temp": "Cold in Northern Hemisphere, Warm in Southern", "conditions": "Variable"},
        "february": {"temp": "Cold to Mild", "conditions": "Variable"},
        "march": {"temp": "Mild, Spring beginning", "conditions": "Rainy in many regions"},
        "april": {"temp": "Mild to Warm", "conditions": "Generally pleasant"},
        "may": {"temp": "Warm", "conditions": "Good weather in most places"},
        "june": {"temp": "Hot in Northern Hemisphere", "conditions": "Summer season begins"},
        "july": {"temp": "Hot", "conditions": "Peak summer, monsoon in Asia"},
        "august": {"temp": "Hot", "conditions": "Peak summer continues"},
        "september": {"temp": "Warm to Mild", "conditions": "Shoulder season begins"},
        "october": {"temp": "Mild to Cool", "conditions": "Fall colors, pleasant"},
        "november": {"temp": "Cool to Cold", "conditions": "Variable"},
        "december": {"temp": "Cold in Northern Hemisphere", "conditions": "Holiday season, winter"}
    }
    
    month_lower = month.lower()[:3]
    
    for m, data in weather_data.items():
        if m.startswith(month_lower):
            return {
                "destination": destination,
                "month": month,
                "temperature": data["temp"],
                "conditions": data["conditions"],
                "recommendation": "Pack accordingly and check specific forecasts closer to your trip"
            }
    
    return {
        "destination": destination,
        "month": month,
        "error": "Could not find weather data for this month"
    }


@weave.op()
def create_itinerary(destination: str, duration_days: int, interests: str) -> dict:
    """
    Create a day-by-day travel itinerary.
    
    Args:
        destination: The travel destination
        duration_days: Number of days for the trip
        interests: User's interests (culture, food, adventure, relaxation)
    
    Returns:
        Itinerary dictionary
    """
    # Base activities by interest
    activities = {
        "culture": ["Visit local museums", "Historical walking tour", "Traditional craft workshop", "Local temple/church visit"],
        "food": ["Food market tour", "Cooking class", "Fine dining experience", "Street food exploration"],
        "adventure": ["Hiking excursion", "Water sports", "Zip-lining/Bungee", "Wildlife tour"],
        "relaxation": ["Spa day", "Beach time", "Sunset cruise", "Yoga session"]
    }
    
    # Determine primary interest
    interest_lower = interests.lower()
    primary_interest = "culture"  # default
    for interest in activities.keys():
        if interest in interest_lower:
            primary_interest = interest
            break
    
    # Create itinerary
    itinerary = []
    activity_pool = activities[primary_interest] + ["Free time to explore", "Local cafe experience"]
    
    for day in range(1, min(duration_days + 1, 15)):  # Cap at 14 days
        day_plan = {
            "day": day,
            "morning": activity_pool[day % len(activity_pool)],
            "afternoon": activity_pool[(day + 1) % len(activity_pool)],
            "evening": "Dinner at local restaurant" if day % 2 == 0 else "Evening stroll and nightlife"
        }
        itinerary.append(day_plan)
    
    return {
        "destination": destination,
        "duration": duration_days,
        "focus": primary_interest,
        "itinerary": itinerary,
        "tips": [
            "Book accommodations in advance",
            "Learn a few local phrases",
            "Keep digital copies of important documents",
            "Check visa requirements"
        ]
    }


@weave.op()
def estimate_budget(destination: str, duration_days: int, travel_style: str) -> dict:
    """
    Estimate the budget for a trip.
    
    Args:
        destination: The travel destination
        duration_days: Number of days
        travel_style: budget, moderate, or luxury
    
    Returns:
        Budget breakdown dictionary
    """
    # Daily cost estimates (simplified)
    daily_costs = {
        "budget": {"accommodation": 30, "food": 20, "activities": 15, "transport": 10},
        "moderate": {"accommodation": 100, "food": 50, "activities": 40, "transport": 30},
        "luxury": {"accommodation": 300, "food": 150, "activities": 100, "transport": 80}
    }
    
    style_lower = travel_style.lower()
    if "budget" in style_lower or "cheap" in style_lower:
        style_key = "budget"
    elif "luxury" in style_lower:
        style_key = "luxury"
    else:
        style_key = "moderate"
    
    costs = daily_costs[style_key]
    daily_total = sum(costs.values())
    
    return {
        "destination": destination,
        "duration": duration_days,
        "style": style_key,
        "daily_breakdown": costs,
        "daily_total": daily_total,
        "trip_total": daily_total * duration_days,
        "currency": "USD",
        "note": "Estimates exclude flights. Actual costs vary by destination and season."
    }


# Create the Travel Planner Agent
def create_travel_agent():
    """Create and return the travel planner agent."""
    
    travel_agent = Agent(
        name="travel_planner",
        model=LiteLlm(model="gemini/gemini-2.0-flash"),
        description="A helpful travel planning assistant that helps users plan their perfect trip.",
        instruction="""You are a friendly and knowledgeable travel planning assistant. Your goal is to help users plan amazing trips.

When helping users:
1. First understand their preferences (destination type, budget, duration, interests)
2. Use the search_destinations tool to find suitable places
3. Use get_weather_info to advise on the best time to visit
4. Use create_itinerary to build a day-by-day plan
5. Use estimate_budget to give them cost expectations

Be conversational, enthusiastic about travel, and provide helpful tips. If users are vague, ask clarifying questions.

Always be helpful and suggest alternatives if their first choice doesn't work out.""",
        tools=[
            search_destinations,
            get_weather_info,
            create_itinerary,
            estimate_budget
        ]
    )
    
    return travel_agent


# Session and Runner setup
session_service = InMemorySessionService()


@weave.op()
async def chat_with_agent(user_id: str, session_id: str, message: str) -> str:
    """
    Send a message to the travel planner agent and get a response.
    
    Args:
        user_id: Unique user identifier
        session_id: Session identifier for conversation continuity
        message: User's message
    
    Returns:
        Agent's response
    """
    agent = create_travel_agent()
    runner = Runner(
        agent=agent,
        app_name="travel_planner_app",
        session_service=session_service
    )
    
    # Create or get session
    session = session_service.get_session(
        app_name="travel_planner_app",
        user_id=user_id,
        session_id=session_id
    )
    
    if session is None:
        session = session_service.create_session(
            app_name="travel_planner_app",
            user_id=user_id,
            session_id=session_id
        )
    
    # Create user message content
    user_content = types.Content(
        role="user",
        parts=[types.Part.from_text(text=message)]
    )
    
    # Run the agent and collect response
    response_parts = []
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=user_content
    ):
        if hasattr(event, 'content') and event.content:
            for part in event.content.parts:
                if hasattr(part, 'text') and part.text:
                    response_parts.append(part.text)
    
    return "".join(response_parts) if response_parts else "I'm sorry, I couldn't generate a response."


# CLI for testing
async def main():
    """Main function to run the travel planner agent interactively."""
    import uuid
    
    print("🌍 Welcome to the Travel Planner Assistant!")
    print("=" * 50)
    print("I can help you plan your perfect trip.")
    print("Type 'quit' to exit.\n")
    
    user_id = f"user_{uuid.uuid4().hex[:8]}"
    session_id = f"session_{uuid.uuid4().hex[:8]}"
    
    while True:
        try:
            user_input = input("\nYou: ").strip()
            
            if user_input.lower() in ['quit', 'exit', 'q']:
                print("\n✈️ Safe travels! Goodbye!")
                break
            
            if not user_input:
                continue
            
            print("\nAssistant: ", end="", flush=True)
            response = await chat_with_agent(user_id, session_id, user_input)
            print(response)
            
        except KeyboardInterrupt:
            print("\n\n✈️ Safe travels! Goodbye!")
            break
        except Exception as e:
            print(f"\nError: {e}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())

