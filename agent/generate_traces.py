"""
Generate traces for error analysis demo.

Simply runs conversations - ADK's OTEL tracing + Weave handles the rest.
"""

import os
import asyncio
import uuid
from dotenv import load_dotenv

load_dotenv()

# Import agent (this also sets up OTEL tracing)
from customer_support import create_support_agent, chat
from google.adk.runners import InMemoryRunner


# Test conversations - designed to surface potential issues
CONVERSATIONS = [
    # Straightforward questions
    ["What's the price of the Pro plan?"],
    ["How do I cancel my subscription?"],
    ["What features are in the Business plan?"],
    
    # Multi-turn conversations
    [
        "I want to upgrade from Free to Pro",
        "Can I pay annually?",
        "What's the difference in price?"
    ],
    [
        "I need to add more users to my team",
        "We're on Business plan with 5 seats",
        "How much for 10 more users?"
    ],
    
    # Refund scenarios (policy edge cases)
    [
        "I want a refund",
        "I signed up 45 days ago on the annual plan",
        "This is my first time subscribing"
    ],
    [
        "Can I get my money back?",
        "I've been a customer for 6 months",
        "I'm on the monthly Pro plan"
    ],
    
    # Potential confusion/errors
    ["Is there a 50% discount for students?"],  # No student discount exists
    ["What's the Enterprise plan cost?"],  # No Enterprise plan
    ["Can I get phone support?"],  # No phone support offered
    ["How many projects can I have on Pro?"],  # Should say unlimited
    
    # Account-specific queries
    [
        "My email is john@example.com",
        "When is my next billing date?",
        "Can I switch to annual billing?"
    ],
    [
        "I'm sarah@company.com",
        "How many seats do we have?",
        "What's our renewal date?"
    ],
    
    # Edge cases
    ["What happens if my payment fails?"],
    ["How do I export my data before deleting my account?"],
    ["Is TaskFlow SOC 2 compliant?"],  # Only for Business plan
    ["What's the response time for support?"],
    
    # Tricky questions
    [
        "I'm on the Free plan",
        "But I need calendar integration",
        "Is there any way to get it without paying?"
    ],
    ["Can you extend my trial?"],
    ["My competitor offers more features for less, can you match?"],
]


async def run_conversation(messages: list[str]):
    """Run a single conversation."""
    agent = create_support_agent()
    runner = InMemoryRunner(agent=agent, app_name="taskflow_support")
    
    user_id = f"user_{uuid.uuid4().hex[:8]}"
    session_id = f"session_{uuid.uuid4().hex[:8]}"
    
    await runner.session_service.create_session(
        app_name="taskflow_support",
        user_id=user_id,
        session_id=session_id,
    )
    
    print(f"\n{'─'*50}")
    for msg in messages:
        print(f"User: {msg}")
        response = await chat(msg, runner, user_id, session_id)
        print(f"Agent: {response[:200]}..." if len(response) > 200 else f"Agent: {response}")
    print(f"{'─'*50}")


async def main():
    print("🚀 Generating traces for TaskFlow Support")
    print(f"Project: {os.getenv('WEAVE_PROJECT', 'error-analysis-demo')}")
    print(f"Conversations: {len(CONVERSATIONS)}\n")
    
    for i, messages in enumerate(CONVERSATIONS, 1):
        print(f"[{i}/{len(CONVERSATIONS)}]", end="")
        try:
            await run_conversation(messages)
        except Exception as e:
            print(f" ERROR: {e}")
        await asyncio.sleep(0.5)
    
    print("\n✅ Done! View traces at https://wandb.ai/")


if __name__ == "__main__":
    asyncio.run(main())
