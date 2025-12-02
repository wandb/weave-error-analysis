"""
AGENT_INFO.md parser and schema definitions.

This module provides Pydantic models and parsing utilities for the AGENT_INFO.md
protocol, which documents user agents for synthetic data generation and automated review.
"""

import re
import json
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime


# =============================================================================
# Pydantic Models for AGENT_INFO
# =============================================================================

class Tool(BaseModel):
    """A tool available to the agent."""
    name: str
    purpose: str
    inputs: str
    outputs: str


class TestingDimension(BaseModel):
    """A dimension for synthetic data generation."""
    name: str
    values: List[str]
    descriptions: Optional[Dict[str, str]] = None


class AgentInfo(BaseModel):
    """Parsed AGENT_INFO.md content."""
    # Metadata
    name: str
    version: str = "1.0.0"
    agent_type: Optional[str] = None
    framework: Optional[str] = None
    
    # Purpose & Scope
    purpose: Optional[str] = None
    target_audience: List[str] = Field(default_factory=list)
    capabilities: List[str] = Field(default_factory=list)
    limitations: List[str] = Field(default_factory=list)
    
    # System Prompts
    system_prompt: Optional[str] = None
    
    # Tools
    tools: List[Tool] = Field(default_factory=list)
    
    # Domain Knowledge
    domain_knowledge: Optional[str] = None
    
    # Testing Dimensions
    testing_dimensions: List[TestingDimension] = Field(default_factory=list)
    
    # Success Criteria
    success_criteria: List[str] = Field(default_factory=list)


# =============================================================================
# Markdown Parser
# =============================================================================

class AgentInfoParser:
    """Parser for AGENT_INFO.md markdown files."""
    
    def __init__(self):
        self.section_patterns = {
            'metadata': r'##\s*Agent\s+Metadata',
            'purpose': r'##\s*Purpose\s*&?\s*Scope',
            'system_prompts': r'##\s*System\s+Prompts?',
            'domain_knowledge': r'##\s*Domain\s+Knowledge',
            'testing_dimensions': r'##\s*Testing\s+Dimensions?',
            'success_criteria': r'##\s*Success\s+Criteria',
        }
    
    def parse(self, markdown_content: str) -> AgentInfo:
        """Parse AGENT_INFO.md content into structured data."""
        sections = self._split_into_sections(markdown_content)
        
        # Parse metadata
        name = self._extract_metadata_field(sections.get('metadata', ''), 'Name') or 'Unnamed Agent'
        version = self._extract_metadata_field(sections.get('metadata', ''), 'Version') or '1.0.0'
        agent_type = self._extract_metadata_field(sections.get('metadata', ''), 'Type')
        framework = self._extract_metadata_field(sections.get('metadata', ''), 'Framework')
        
        # Parse purpose section
        purpose_section = sections.get('purpose', '')
        purpose = self._extract_first_paragraph(purpose_section)
        target_audience = self._extract_list_after_heading(purpose_section, 'Target Audience')
        capabilities = self._extract_list_after_heading(purpose_section, 'Capabilities')
        limitations = self._extract_list_after_heading(purpose_section, 'Limitations')
        
        # Parse system prompts
        system_prompt = self._extract_code_block(sections.get('system_prompts', ''))
        if not system_prompt:
            system_prompt = self._extract_after_heading(sections.get('system_prompts', ''), 'Primary System Prompt')
        
        # Parse tools from table
        tools = self._extract_tools_table(sections.get('system_prompts', ''))
        
        # Parse domain knowledge
        domain_knowledge = sections.get('domain_knowledge', '').strip()
        
        # Parse testing dimensions
        testing_dimensions = self._extract_testing_dimensions(sections.get('testing_dimensions', ''))
        
        # Parse success criteria
        success_criteria = self._extract_numbered_list(sections.get('success_criteria', ''))
        
        return AgentInfo(
            name=name,
            version=version,
            agent_type=agent_type,
            framework=framework,
            purpose=purpose,
            target_audience=target_audience,
            capabilities=capabilities,
            limitations=limitations,
            system_prompt=system_prompt,
            tools=tools,
            domain_knowledge=domain_knowledge,
            testing_dimensions=testing_dimensions,
            success_criteria=success_criteria,
        )
    
    def _split_into_sections(self, content: str) -> Dict[str, str]:
        """Split markdown into sections based on ## headers."""
        sections = {}
        current_section = 'header'
        current_content = []
        
        for line in content.split('\n'):
            # Check if this is a section header
            section_found = None
            for section_name, pattern in self.section_patterns.items():
                if re.match(pattern, line, re.IGNORECASE):
                    section_found = section_name
                    break
            
            if section_found:
                # Save previous section
                if current_content:
                    sections[current_section] = '\n'.join(current_content)
                current_section = section_found
                current_content = []
            else:
                current_content.append(line)
        
        # Save last section
        if current_content:
            sections[current_section] = '\n'.join(current_content)
        
        return sections
    
    def _extract_metadata_field(self, content: str, field_name: str) -> Optional[str]:
        """Extract a metadata field like '- **Name**: Value'."""
        pattern = rf'-\s*\*\*{field_name}\*\*:\s*(.+?)(?:\n|$)'
        match = re.search(pattern, content, re.IGNORECASE)
        if match:
            return match.group(1).strip()
        return None
    
    def _extract_first_paragraph(self, content: str) -> Optional[str]:
        """Extract the first non-empty paragraph."""
        lines = []
        in_paragraph = False
        
        for line in content.split('\n'):
            line = line.strip()
            if not line:
                if in_paragraph:
                    break
                continue
            if line.startswith('#'):
                if in_paragraph:
                    break
                continue
            in_paragraph = True
            lines.append(line)
        
        return ' '.join(lines) if lines else None
    
    def _extract_list_after_heading(self, content: str, heading: str) -> List[str]:
        """Extract a bullet list after a ### heading."""
        pattern = rf'###\s*{heading}.*?\n((?:[-*]\s*.+\n?)+)'
        match = re.search(pattern, content, re.IGNORECASE | re.DOTALL)
        if not match:
            return []
        
        list_content = match.group(1)
        items = []
        for line in list_content.split('\n'):
            line = line.strip()
            if line.startswith('-') or line.startswith('*'):
                item = re.sub(r'^[-*]\s*', '', line).strip()
                if item:
                    items.append(item)
        
        return items
    
    def _extract_after_heading(self, content: str, heading: str) -> Optional[str]:
        """Extract text after a ### heading until the next heading."""
        pattern = rf'###\s*{heading}.*?\n(.*?)(?=###|$)'
        match = re.search(pattern, content, re.IGNORECASE | re.DOTALL)
        if match:
            return match.group(1).strip()
        return None
    
    def _extract_code_block(self, content: str) -> Optional[str]:
        """Extract content from a code block."""
        pattern = r'```(?:\w*)\n(.*?)```'
        match = re.search(pattern, content, re.DOTALL)
        if match:
            return match.group(1).strip()
        return None
    
    def _extract_tools_table(self, content: str) -> List[Tool]:
        """Extract tools from a markdown table."""
        tools = []
        
        # Find table rows (skip header and separator)
        lines = content.split('\n')
        in_table = False
        
        for line in lines:
            if '|' in line and 'Tool Name' in line:
                in_table = True
                continue
            if in_table and line.strip().startswith('|--'):
                continue
            if in_table and '|' in line:
                parts = [p.strip() for p in line.split('|')[1:-1]]
                if len(parts) >= 4:
                    tools.append(Tool(
                        name=parts[0],
                        purpose=parts[1],
                        inputs=parts[2],
                        outputs=parts[3]
                    ))
        
        return tools
    
    def _extract_testing_dimensions(self, content: str) -> List[TestingDimension]:
        """Extract testing dimensions from subsections."""
        dimensions = []
        
        # Find ### headings within the testing dimensions section
        pattern = r'###\s*(\w+)\s*\n((?:[-*]\s*.+:\s*.+\n?)+)'
        matches = re.findall(pattern, content, re.IGNORECASE)
        
        for name, items_content in matches:
            values = []
            descriptions = {}
            
            for line in items_content.split('\n'):
                line = line.strip()
                if line.startswith('-') or line.startswith('*'):
                    # Format: "- value_name: description"
                    item = re.sub(r'^[-*]\s*', '', line)
                    if ':' in item:
                        value, desc = item.split(':', 1)
                        value = value.strip()
                        desc = desc.strip()
                        values.append(value)
                        descriptions[value] = desc
                    else:
                        values.append(item.strip())
            
            if values:
                dimensions.append(TestingDimension(
                    name=name.lower(),
                    values=values,
                    descriptions=descriptions if descriptions else None
                ))
        
        return dimensions
    
    def _extract_numbered_list(self, content: str) -> List[str]:
        """Extract a numbered list."""
        items = []
        pattern = r'^\d+\.\s*(.+)$'
        
        for line in content.split('\n'):
            match = re.match(pattern, line.strip())
            if match:
                items.append(match.group(1).strip())
        
        return items


# =============================================================================
# Utility Functions
# =============================================================================

def parse_agent_info(markdown_content: str) -> AgentInfo:
    """Parse AGENT_INFO.md content into structured data."""
    parser = AgentInfoParser()
    return parser.parse(markdown_content)


def validate_agent_info(markdown_content: str) -> Dict[str, Any]:
    """
    Validate AGENT_INFO.md content and return validation results.
    
    Returns:
        Dict with 'valid', 'parsed', 'warnings', and 'errors' keys.
    """
    errors = []
    warnings = []
    
    try:
        parsed = parse_agent_info(markdown_content)
        
        # Check required fields
        if not parsed.name or parsed.name == 'Unnamed Agent':
            warnings.append("Agent name not found in metadata")
        
        if not parsed.purpose:
            warnings.append("Purpose section is empty")
        
        if not parsed.capabilities:
            warnings.append("No capabilities listed")
        
        if not parsed.testing_dimensions:
            warnings.append("No testing dimensions defined - synthetic data generation will be limited")
        
        if not parsed.success_criteria:
            warnings.append("No success criteria defined - automated review may be less effective")
        
        return {
            "valid": len(errors) == 0,
            "parsed": parsed.model_dump(),
            "warnings": warnings,
            "errors": errors
        }
    
    except Exception as e:
        errors.append(f"Failed to parse AGENT_INFO.md: {str(e)}")
        return {
            "valid": False,
            "parsed": None,
            "warnings": warnings,
            "errors": errors
        }


# =============================================================================
# Template Generator
# =============================================================================

AGENT_INFO_TEMPLATE = """# AGENT_INFO.md

## Agent Metadata
- **Name**: {name}
- **Version**: 1.0.0
- **Type**: {agent_type}
- **Framework**: {framework}

## Purpose & Scope
{purpose}

### Target Audience
- [Describe your target users]

### Capabilities
1. [List what your agent can do]
2. [Each capability on its own line]

### Limitations
- [What your agent cannot do]
- [Important constraints]

## System Prompts

### Primary System Prompt
```
[Paste your agent's system prompt here]
```

### Tool Descriptions
| Tool Name | Purpose | Inputs | Outputs |
|-----------|---------|--------|---------|
| example_tool | What it does | param1: type | Return description |

## Domain Knowledge

### Key Information
[Document important domain knowledge your agent uses]

## Testing Dimensions

### personas
- user_type_1: Description of this user type
- user_type_2: Description of another user type

### scenarios
- scenario_1: Description of this scenario
- scenario_2: Description of another scenario

### complexity
- simple: Single-step interactions
- complex: Multi-step interactions requiring multiple tool calls

## Success Criteria
1. [Define what success looks like]
2. [Measurable criteria for evaluation]
3. [What the agent should always/never do]
"""


def generate_template(
    name: str = "My Agent",
    agent_type: str = "General",
    framework: str = "Unknown",
    purpose: str = "Describe what your agent does here."
) -> str:
    """Generate a blank AGENT_INFO.md template."""
    return AGENT_INFO_TEMPLATE.format(
        name=name,
        agent_type=agent_type,
        framework=framework,
        purpose=purpose
    )

