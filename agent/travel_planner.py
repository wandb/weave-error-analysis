"""
Travel Planner Agent using Google ADK with W&B Weave Instrumentation

A conversational travel planning assistant that uses LLM capabilities
to help users plan trips. Instrumented with Weave for observability.
"""

import os
from datetime import datetime
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


# Simple utility tools that provide real functionality
@weave.op()
def get_current_date() -> str:
    """Get the current date. Useful for planning trips relative to today."""
    return datetime.now().strftime("%A, %B %d, %Y")


@weave.op()
def calculate_trip_duration(start_date: str, end_date: str) -> dict:
    """
    Calculate the duration between two dates.

    Args:
        start_date: Start date in format 'YYYY-MM-DD'
        end_date: End date in format 'YYYY-MM-DD'

    Returns:
        Dictionary with duration details
    """
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date, "%Y-%m-%d")
        delta = end - start
        
        if delta.days < 0:
            return {"error": "End date must be after start date"}
        
        return {
            "start_date": start_date,
            "end_date": end_date,
            "total_days": delta.days,
            "nights": delta.days,
            "weeks": delta.days // 7,
            "remaining_days": delta.days % 7
        }
    except ValueError as e:
        return {"error": f"Invalid date format. Use YYYY-MM-DD. Details: {str(e)}"}


@weave.op()
def calculate_budget(daily_amount: float, num_days: int, currency: str = "USD") -> dict:
    """
    Calculate total trip budget based on daily spending.
    
    Args:
        daily_amount: Estimated daily spending
        num_days: Number of days
        currency: Currency code (default USD)
    
    Returns:
        Budget breakdown
    """
    total = daily_amount * num_days
    return {
        "daily_budget": daily_amount,
        "num_days": num_days,
        "total_budget": total,
        "currency": currency,
        "breakdown": {
            "accommodation_estimate": round(total * 0.4, 2),
            "food_estimate": round(total * 0.25, 2),
            "activities_estimate": round(total * 0.2, 2),
            "transport_estimate": round(total * 0.15, 2)
        }
    }


def create_travel_agent():
    """Create and return the travel planner agent."""
    
    travel_agent = Agent(
        name="travel_planner",
        model=LiteLlm(model="gemini/gemini-2.0-flash"),
        description="A helpful travel planning assistant.",
        instruction="""You are an expert travel planning assistant. Help users plan their trips by:

1. Understanding their preferences, interests, and constraints
2. Suggesting destinations that match their criteria
3. Providing practical advice on timing, weather, and local customs
4. Helping with itinerary planning and time management
5. Offering budget guidance and money-saving tips

Be conversational and enthusiastic about travel. Ask clarifying questions when needed.
Use the available tools when helpful:
- get_current_date: To understand timing relative to today
- calculate_trip_duration: To help with date math
- calculate_budget: To break down costs

Draw on your knowledge to provide specific, actionable recommendations about:
- Best times to visit destinations
- Must-see attractions and hidden gems
- Local cuisine and restaurants
- Transportation options
- Cultural tips and etiquette
- Packing suggestions

If you don't know something specific, be honest about it rather than making up details.""",
        tools=[
            get_current_date,
            calculate_trip_duration,
            calculate_budget
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
