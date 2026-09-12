from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class ActionStep(BaseModel):
    action_type: str = Field(..., description="Action primitive: click, type, scroll, wait_for_mutation, finish")
    target_selector: Optional[str] = Field(None, description="CSS selector for target element")
    text_fallback: Optional[str] = Field(None, description="Fuzzy text matcher fallback")
    value: Optional[str] = Field(None, description="Value to input for type actions")
    coordinates: Optional[Dict[str, float]] = Field(None, description="Bounding x, y coordinates")
    timeout: Optional[int] = Field(3000, description="Timeout for wait actions")

class PlanRequest(BaseModel):
    goal: str = Field(..., description="User high-level prompt goal")
    image: str = Field(..., description="Anonymized WebP image base64 data URL")
    tab_info: Optional[Dict[str, Any]] = Field(default_factory=dict)

class PlanResponse(BaseModel):
    status: str = Field("in_progress", description="Plan state: in_progress, completed, failed")
    message: str = Field("", description="Explanatory text from VLM")
    steps: List[ActionStep] = Field(default_factory=list)
