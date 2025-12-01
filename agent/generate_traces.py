"""
Generate sample traces for the error analysis demo.

Runs various scenarios through the travel planner agent to generate
traces in W&B Weave for analysis.
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

# Realistic test scenarios - mix of straightforward and edge cases
TEST_SCENARIOS = [
    # Straightforward requests
    {
        "name": "Simple trip inquiry",
        "messages": [
            "I want to plan a trip to Japan",
            "I'm thinking about 2 weeks in April. What should I know?",
            "What's the budget look like for a moderate traveler?"
        ]
    },
    {
        "name": "Weekend getaway",
        "messages": [
            "I need a quick weekend trip from San Francisco",
            "Something relaxing, maybe wine country?",
            "What's the best time to go?"
        ]
    },
    {
        "name": "Family vacation planning",
        "messages": [
            "Planning a family trip with two kids ages 8 and 12",
            "They love theme parks and beaches",
            "We have about $5000 budget for a week"
        ]
    },
    
    # Edge cases that might reveal issues
    {
        "name": "Vague request",
        "messages": [
            "I want to go somewhere nice",
            "Not sure when",
            "Budget is flexible"
        ]
    },
    {
        "name": "Complex date handling",
        "messages": [
            "I want to travel from December 28 to January 5",
            "How many days is that?",
            "What destinations are good for New Year's?"
        ]
    },
    {
        "name": "Budget constraints",
        "messages": [
            "I only have $500 for a week-long international trip",
            "Is that even possible?",
            "What are my options?"
        ]
    },
    {
        "name": "Last minute planning",
        "messages": [
            "I need to book a trip for next week",
            "Going to Paris",
            "What should I prioritize with only 3 days?"
        ]
    },
    {
        "name": "Special requirements",
        "messages": [
            "Planning a trip with my elderly mother who uses a wheelchair",
            "She wants to see the Grand Canyon",
            "What's accessible there?"
        ]
    },
    {
        "name": "Multi-destination trip",
        "messages": [
            "I want to visit London, Paris, and Rome in 10 days",
            "Is that realistic?",
            "How should I split the time?"
        ]
    },
    {
        "name": "Off-season travel",
        "messages": [
            "Is Iceland good to visit in November?",
            "I want to see the Northern Lights",
            "What about the weather?"
        ]
    },
    {
        "name": "Solo female traveler",
        "messages": [
            "I'm a solo female traveler going to Morocco",
            "Any safety tips?",
            "Best areas to stay in Marrakech?"
        ]
    },
    {
        "name": "Honeymoon planning",
        "messages": [
            "Planning our honeymoon for next June",
            "We want something romantic and secluded",
            "Budget around $8000 for two weeks"
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
            display_response = response[:300] + "..." if len(response) > 300 else response
            print(f"Assistant: {display_response}")
        except Exception as e:
            print(f"ERROR: {e}")
        
        # Small delay between messages
        await asyncio.sleep(0.5)


async def main():
    """Generate traces by running all test scenarios."""
    print("🚀 Starting trace generation for error analysis demo")
    print(f"Project: {os.getenv('WEAVE_PROJECT', 'error-analysis-demo')}")
    print(f"Running {len(TEST_SCENARIOS)} scenarios...")
    
    for scenario in TEST_SCENARIOS:
        try:
            await run_scenario(scenario)
        except Exception as e:
            print(f"Failed scenario '{scenario['name']}': {e}")
        # Delay between scenarios
        await asyncio.sleep(1)
    
    print("\n" + "="*60)
    print("✅ Trace generation complete!")
    print("View your traces at: https://wandb.ai/")
    print("="*60)


if __name__ == "__main__":
    asyncio.run(main())
