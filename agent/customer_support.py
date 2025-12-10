"""
Customer Support Agent for TaskFlow (fictional productivity app)

Uses Google ADK with native OTEL tracing → W&B Weave.
"""

import os
import base64
import asyncio
from datetime import datetime
from dotenv import load_dotenv

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import InMemoryRunner
from google.adk.tools import FunctionTool
from google.genai import types

load_dotenv()


def setup_weave_otel() -> None:
    """Configure OTEL to send traces to W&B Weave."""
    wandb_api_key = os.getenv("WANDB_API_KEY")
    wandb_entity = os.getenv("WANDB_ENTITY")  # Your W&B username or team
    wandb_project = os.getenv("WEAVE_PROJECT", "error-analysis-demo")
    
    if not wandb_api_key:
        print("Warning: WANDB_API_KEY not set, tracing disabled")
        return
    
    if not wandb_entity:
        print("Warning: WANDB_ENTITY not set, tracing disabled")
        print("Set WANDB_ENTITY to your W&B username (e.g., 'ayut')")
        return
    
    # Project ID must be in format: entity/project
    project_id = f"{wandb_entity}/{wandb_project}"
    
    # Configure Weave endpoint
    WANDB_BASE_URL = "https://trace.wandb.ai"
    OTEL_EXPORTER_OTLP_ENDPOINT = f"{WANDB_BASE_URL}/otel/v1/traces"
    
    # Set up authentication
    AUTH = base64.b64encode(f"api:{wandb_api_key}".encode()).decode()
    OTEL_EXPORTER_OTLP_HEADERS = {
        "Authorization": f"Basic {AUTH}",
        "project_id": project_id,
    }
    
    # Create the OTLP span exporter
    exporter = OTLPSpanExporter(
        endpoint=OTEL_EXPORTER_OTLP_ENDPOINT,
        headers=OTEL_EXPORTER_OTLP_HEADERS,
    )
    
    # Create tracer provider and add exporter
    # Using BatchSpanProcessor for better async/concurrent support
    # It batches spans and exports them in the background, avoiding
    # context issues with concurrent requests
    global _tracer_provider
    _tracer_provider = trace_sdk.TracerProvider()
    _tracer_provider.add_span_processor(BatchSpanProcessor(
        exporter,
        max_queue_size=2048,
        max_export_batch_size=512,
        schedule_delay_millis=500,  # Export every 0.5 seconds for faster trace visibility
    ))
    
    # Set the global tracer provider
    trace.set_tracer_provider(_tracer_provider)
    
    print(f"OTEL tracing configured for project: {project_id}")
    print(f"View traces at: https://wandb.ai/{project_id}/weave")


# Global reference to tracer provider for flushing
_tracer_provider: trace_sdk.TracerProvider = None


def flush_traces(timeout_millis: int = 5000) -> bool:
    """
    Force flush all pending traces to Weave.
    
    Call this after completing agent runs to ensure traces are exported
    before the response is sent, especially important for batch execution.
    
    Returns:
        True if flush succeeded, False otherwise
    """
    if _tracer_provider is None:
        return False
    try:
        return _tracer_provider.force_flush(timeout_millis)
    except Exception:
        return False


# Initialize OTEL tracing
setup_weave_otel()


# ============================================================
# TASKFLOW PRODUCT DEFINITION (Ground Truth for Validation)
# ============================================================

TASKFLOW_INFO = """
# TaskFlow - Product Information

## Pricing Tiers

### Free Plan - $0/month
- Up to 3 projects
- Up to 100 tasks
- Basic task management
- Mobile app access
- 7-day task history

### Pro Plan - $9/month (or $89/year)
- Unlimited projects
- Unlimited tasks
- Priority support
- 30-day task history
- Calendar integration
- File attachments (up to 25MB)
- Recurring tasks

### Business Plan - $19/user/month (minimum 5 users)
- Everything in Pro
- Team collaboration
- Admin controls
- SSO/SAML
- API access
- 1-year task history
- Dedicated support
- Custom integrations

## Policies

### Refund Policy
- 30-day money-back guarantee for first-time subscribers
- Annual plans: Prorated refund within first 60 days
- No refunds after 60 days for annual plans
- Monthly plans: No refunds, but can cancel anytime

### Free Trial
- 14-day free trial of Pro plan
- No credit card required
- Automatic downgrade to Free after trial

### Billing
- Monthly plans billed on signup date
- Annual plans billed annually on signup date
- Payment methods: Credit card, PayPal, Apple Pay
- Failed payments: 3 retry attempts over 7 days, then account downgraded

### Data & Privacy
- Data exported anytime via Settings > Export
- Account deletion: Data removed within 30 days
- GDPR compliant
- SOC 2 Type II certified (Business plan)

### Support Hours
- Free: Community forum only
- Pro: Email support, 24-48 hour response
- Business: Priority email + chat, 4-hour response SLA
"""


# ============================================================
# TOOLS
# ============================================================

def get_product_info() -> str:
    """Get TaskFlow product information including pricing and policies."""
    return TASKFLOW_INFO


def check_subscription_status(user_email: str) -> dict:
    """
    Check a user's subscription status.
    
    Args:
        user_email: The user's email address
    
    Returns:
        Subscription details
    """
    # Simulated user database for demo
    demo_users = {
        "john@example.com": {
            "plan": "Pro",
            "billing_cycle": "monthly",
            "next_billing": "2025-01-15",
            "status": "active"
        },
        "sarah@company.com": {
            "plan": "Business",
            "billing_cycle": "annual",
            "next_billing": "2025-06-01",
            "status": "active",
            "seats": 12
        },
        "demo@test.com": {
            "plan": "Free",
            "status": "active"
        }
    }
    
    if user_email.lower() in demo_users:
        return {"found": True, "user": user_email, **demo_users[user_email.lower()]}
    return {"found": False, "user": user_email, "message": "User not found in system"}


def process_refund_request(user_email: str, reason: str) -> dict:
    """
    Process a refund request.
    
    Args:
        user_email: The user's email address
        reason: Reason for refund
    
    Returns:
        Refund request status
    """
    # Check eligibility (simplified)
    return {
        "request_id": f"REF-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "user": user_email,
        "reason": reason,
        "status": "submitted",
        "message": "Refund request submitted. Our billing team will review within 2-3 business days."
    }


def get_current_date() -> str:
    """Get the current date."""
    return datetime.now().strftime("%Y-%m-%d")


# Create FunctionTools
product_info_tool = FunctionTool(func=get_product_info)
subscription_tool = FunctionTool(func=check_subscription_status)
refund_tool = FunctionTool(func=process_refund_request)
date_tool = FunctionTool(func=get_current_date)


# ============================================================
# AGENT
# ============================================================

SYSTEM_PROMPT = """You are a helpful customer support agent for TaskFlow, a productivity and task management application.

Your role is to:
1. Answer questions about TaskFlow's features, pricing, and policies
2. Help users with account and billing issues
3. Troubleshoot common problems
4. Escalate complex issues appropriately

IMPORTANT GUIDELINES:
- Always use the get_product_info tool to get accurate pricing and policy information
- Never make up prices, features, or policies - always check the product info
- If you're unsure about something, say so and offer to connect them with a human agent
- Be friendly but professional
- For account-specific questions, use check_subscription_status with their email

When handling refund requests:
- First check their subscription status
- Verify eligibility based on our refund policy
- Use process_refund_request to submit if eligible

Do NOT:
- Make promises about features that don't exist
- Guarantee refunds without checking eligibility
- Share other users' information
- Make up response times or SLAs
"""


def create_support_agent() -> LlmAgent:
    """Create the customer support agent."""
    return LlmAgent(
        name="TaskFlowSupport",
        model=LiteLlm(model="openai/gpt-4o-mini"),
        instruction=SYSTEM_PROMPT,
        tools=[product_info_tool, subscription_tool, refund_tool, date_tool],
    )


async def chat(user_message: str, runner: InMemoryRunner, user_id: str, session_id: str) -> str:
    """Send a message and get a response."""
    response_text = ""
    
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=types.Content(
            role="user",
            parts=[types.Part(text=user_message)]
        ),
    ):
        if event.is_final_response() and event.content:
            for part in event.content.parts:
                if hasattr(part, 'text') and part.text:
                    response_text += part.text
    
    return response_text.strip() if response_text else "I apologize, I couldn't generate a response."


async def main():
    """Interactive CLI for the support agent."""
    import uuid
    
    print("🎧 TaskFlow Customer Support")
    print("=" * 50)
    print("How can I help you today?")
    print("Type 'quit' to exit.\n")
    
    agent = create_support_agent()
    runner = InMemoryRunner(agent=agent, app_name="taskflow_support")
    
    user_id = f"user_{uuid.uuid4().hex[:8]}"
    session_id = f"session_{uuid.uuid4().hex[:8]}"
    
    await runner.session_service.create_session(
        app_name="taskflow_support",
        user_id=user_id,
        session_id=session_id,
    )
    
    while True:
        try:
            user_input = input("\nYou: ").strip()
            
            if user_input.lower() in ['quit', 'exit', 'q']:
                print("\nThank you for contacting TaskFlow support. Goodbye!")
                break
            
            if not user_input:
                continue
            
            print("\nSupport: ", end="", flush=True)
            response = await chat(user_input, runner, user_id, session_id)
            print(response)
            
        except KeyboardInterrupt:
            print("\n\nThank you for contacting TaskFlow support. Goodbye!")
            break
        except Exception as e:
            print(f"\nError: {e}")


if __name__ == "__main__":
    asyncio.run(main())

