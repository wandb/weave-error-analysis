"""
Utility functions for data processing and truncation.
"""


def truncate_dict(d: dict, max_length: int = 100) -> dict:
    """Truncate dictionary values for preview."""
    if not d:
        return {}
    result = {}
    for k, v in list(d.items())[:5]:  # Limit to 5 keys
        result[k] = truncate_value(v, max_length)
    return result


def truncate_value(v, max_length: int = 100):
    """Truncate a value for preview."""
    if v is None:
        return None
    if isinstance(v, str):
        return v[:max_length] + "..." if len(v) > max_length else v
    if isinstance(v, dict):
        return truncate_dict(v, max_length)
    if isinstance(v, list):
        return [truncate_value(item, max_length) for item in v[:3]]
    return v

