"""
Generate sample traces for the error analysis demo.

This script runs various scenarios through the travel planner agent
to generate traces in W&B Weave that can be analyzed.
"""

import os
import asyncio
import uuid
from dotenv import load_dotenv
import weave

load_dotenv()

# Initialize Weave
weave.init(os.getenv("WEAVE_PROJECT", "error-analysis-demo"))

from travel_planner import chat_with_agent

# Test scenarios - mix of good and potentially problematic queries
TEST_SCENARIOS = [
    # Good queries
    {
        "name": "Basic beach vacation",
        "messages": [
            "I want to plan a beach vacation",
            "My budget is moderate, around $2000 for a week",
            "I'm interested in Bali, what's the weather like in July?",
            "Can you create a 7-day itinerary focused on relaxation?"
        ]
    },
    {
        "name": "Adventure trip planning",
        "messages": [
            "Looking for an adventure trip",
            "Budget is flexible, maybe luxury",
            "What about New Zealand in December?",
            "Give me a 10-day adventure itinerary"
        ]
    },
    {
        "name": "City exploration",
        "messages": [
            "I want to explore a European city",
            "Moderate budget",
            "How about Barcelona in April?",
            "Create a cultural itinerary for 5 days"
        ]
    },
    # Potentially problematic queries (edge cases for error analysis)
    {
        "name": "Vague request",
        "messages": [
            "I want to go somewhere",
            "Not sure about budget",
            "Whenever is fine"
        ]
    },
    {
        "name": "Conflicting requirements",
        "messages": [
            "I want a luxury beach vacation",
            "But my budget is only $500 for two weeks",
            "Can you make it work?"
        ]
    },
    {
        "name": "Complex date handling",
        "messages": [
            "I want to travel two weeks from now",
            "Maybe late next month",
            "Actually, let's do the third week of March 2025"
        ]
    },
    {
        "name": "Multiple destinations",
        "messages": [
            "I want to visit Paris, Tokyo, and Sydney in one trip",
            "I only have 5 days",
            "Budget is moderate"
        ]
    },
    {
        "name": "Special requirements",
        "messages": [
            "Planning a trip with my elderly parents",
            "They need wheelchair accessibility",
            "Looking for a relaxing mountain destination",
            "Budget is luxury"
        ]
    },
    {
        "name": "Last minute planning",
        "messages": [
            "I need to plan a trip for tomorrow",
            "Going to Tokyo",
            "What should I pack?"
        ]
    },
    {
        "name": "Group trip complexity",
        "messages": [
            "Planning a trip for 15 people",
            "Mix of families with kids and young couples",
            "Some want adventure, some want relaxation",
            "Budget varies from cheap to moderate"
        ]
    },
    # More edge cases
    {
        "name": "Weather-sensitive planning",
        "messages": [
            "I hate rain, where should I go in August?",
            "Also don't like extreme heat",
            "Beach preferred"
        ]
    },
    {
        "name": "Budget breakdown request",
        "messages": [
            "What's the cheapest way to visit Japan?",
            "For 2 weeks",
            "Break down all the costs for me"
        ]
    },
]


async def run_scenario(scenario: dict):
    """Run a single test scenario through the agent."""
    user_id = f"user_{uuid.uuid4().hex[:8]}"
    session_id = f"session_{uuid.uuid4().hex[:8]}"
    
    print(f"\n{'='*60}")
    print(f"Scenario: {scenario['name']}")
    print(f"{'='*60}")
    
    for i, message in enumerate(scenario['messages']):
        print(f"\n[{i+1}/{len(scenario['messages'])}] User: {message}")
        try:
            response = await chat_with_agent(user_id, session_id, message)
            # Truncate long responses for display
            display_response = response[:200] + "..." if len(response) > 200 else response
            print(f"Assistant: {display_response}")
        except Exception as e:
            print(f"ERROR: {e}")
        
        # Small delay between messages
        await asyncio.sleep(1)


async def main():
    """Generate traces by running all test scenarios."""
    print("🚀 Starting trace generation for error analysis demo")
    print(f"Project: {os.getenv('WEAVE_PROJECT', 'error-analysis-demo')}")
    print(f"Running {len(TEST_SCENARIOS)} scenarios...")
    
    for scenario in TEST_SCENARIOS:
        await run_scenario(scenario)
        # Delay between scenarios
        await asyncio.sleep(2)
    
    print("\n" + "="*60)
    print("✅ Trace generation complete!")
    print("View your traces at: https://wandb.ai/")
    print("="*60)


if __name__ == "__main__":
    asyncio.run(main())

