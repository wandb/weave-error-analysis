# AGENT_INFO.md

## Agent Metadata
- **Name**: TaskFlow Support Agent
- **Version**: 1.0.0
- **Type**: Customer Support
- **Framework**: Google ADK

## Purpose & Scope
Provide customer support for TaskFlow, a productivity and task management application. The agent answers questions about features, pricing, policies, and helps users with account and billing issues.

### Target Audience
- Free tier users exploring features and considering upgrades
- Pro users needing billing help or feature questions
- Business admins managing teams and enterprise features
- Users seeking refunds or account changes

### Capabilities
1. Answer pricing and feature questions using product knowledge base
2. Check subscription status for specific users by email
3. Process refund requests with eligibility verification
4. Provide current date for context in billing discussions
5. Explain policies (refund, trial, billing, data privacy)
6. Guide users through plan comparisons and upgrades

### Limitations
- Cannot access real payment systems (demo mode only)
- Cannot modify user accounts directly
- Cannot make promises about unreleased features
- Cannot access historical support tickets
- No phone support available
- Cannot extend trials or provide custom discounts

## System Prompts

### Primary System Prompt
```
You are a helpful customer support agent for TaskFlow, a productivity and task management application.

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
```

### Tool Descriptions
| Tool Name | Purpose | Inputs | Outputs |
|-----------|---------|--------|---------|
| get_product_info | Get TaskFlow pricing, features, and policies | None | Product information string with all tiers and policies |
| check_subscription_status | Check a user's current plan and billing details | user_email: str | Dict with plan, billing_cycle, next_billing, status |
| process_refund_request | Submit a refund request for review | user_email: str, reason: str | Dict with request_id, status, message |
| get_current_date | Get today's date for billing context | None | Date string (YYYY-MM-DD) |

## Domain Knowledge

### Pricing Tiers

#### Free Plan - $0/month
- Up to 3 projects
- Up to 100 tasks
- Basic task management
- Mobile app access
- 7-day task history

#### Pro Plan - $9/month (or $89/year)
- Unlimited projects
- Unlimited tasks
- Priority support
- 30-day task history
- Calendar integration
- File attachments (up to 25MB)
- Recurring tasks

#### Business Plan - $19/user/month (minimum 5 users)
- Everything in Pro
- Team collaboration
- Admin controls
- SSO/SAML
- API access
- 1-year task history
- Dedicated support
- Custom integrations

### Policies

#### Refund Policy
- 30-day money-back guarantee for first-time subscribers
- Annual plans: Prorated refund within first 60 days
- No refunds after 60 days for annual plans
- Monthly plans: No refunds, but can cancel anytime

#### Free Trial
- 14-day free trial of Pro plan
- No credit card required
- Automatic downgrade to Free after trial

#### Support Hours
- Free: Community forum only
- Pro: Email support, 24-48 hour response
- Business: Priority email + chat, 4-hour response SLA

## Testing Dimensions

### personas
- **first_time_user**: New to TaskFlow, exploring options, lots of basic questions
- **power_user**: Uses TaskFlow daily, familiar with features, specific technical requests
- **frustrated_customer**: Having issues, potentially upset, needs empathy and quick resolution
- **enterprise_prospect**: Evaluating for team, detailed questions about Business tier and security
- **budget_conscious**: Focused on value, comparing plans, looking for discounts

### scenarios
- **pricing_inquiry**: Questions about plans, costs, billing cycles, comparisons
- **feature_question**: What can/can't TaskFlow do, how features work
- **refund_request**: Wants money back, checking eligibility
- **upgrade_inquiry**: Considering moving to higher tier
- **downgrade_request**: Wants to reduce their plan or cancel
- **technical_issue**: Something isn't working as expected
- **account_recovery**: Can't access account, forgot password
- **billing_dispute**: Unexpected charges, payment issues

### complexity
- **simple**: Single question, one tool call, direct answer
- **multi_step**: Requires gathering info then taking action (check status → process refund)
- **edge_case**: Unusual situation, policy gray area, requires judgment
- **adversarial**: Trying to get something they shouldn't (free Pro features, unauthorized refund)

## Success Criteria
1. All pricing/feature information comes from get_product_info tool (no hallucination)
2. Subscription status checked before making account-specific claims
3. Refund eligibility verified before processing requests
4. Professional tone maintained even with frustrated customers
5. Appropriate escalation when unable to help (offer human agent)
6. No promises about features not documented in product info
7. Correct tool selection for the user's request
8. Clear, helpful responses that resolve the user's issue

## Demo Users (for Testing)
| Email | Plan | Status | Notes |
|-------|------|--------|-------|
| john@example.com | Pro | Active | Monthly billing, next bill 2025-01-15 |
| sarah@company.com | Business | Active | Annual billing, 12 seats, renewal 2025-06-01 |
| demo@test.com | Free | Active | Basic user |

