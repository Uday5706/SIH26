from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class ActionStep(BaseModel):
    last_action_evaluation: Optional[str] = Field(None, description="Evaluate if the previous action succeeded ('Success' or 'Failed: reason'). If Success, increment current_step_index.")
    roadmap: Optional[List[str]] = Field(None, description="The high-level step-by-step plan.")
    current_step_index: Optional[int] = Field(0, description="The pointer to the current step in the roadmap (0-indexed).")
    thought: Optional[str] = Field(None, description="Briefly reason about the state, previous failures, and the next logical step before acting.")
    expected_outcome: Optional[str] = Field(None, description="What the agent expects to happen visually on the screen after this action.")
    action_type: str = Field(..., description="Action primitive: click, type, scroll, wait_for_mutation, finish")
    target_selector: Optional[str] = Field(None, description="CSS selector for target element")
    text_fallback: Optional[str] = Field(None, description="Fuzzy text matcher fallback")
    value: Optional[str] = Field(None, description="Value to input for type actions")
    coordinates: Optional[Dict[str, float]] = Field(None, description="Bounding x, y coordinates")
    timeout: Optional[int] = Field(3000, description="Timeout for wait actions")

class ViewportSize(BaseModel):
    width: int
    height: int
    devicePixelRatio: float = 1.0
    scrollX: float = 0.0
    scrollY: float = 0.0
    cursor_position: Optional[Dict[str, float]] = Field(None, description="Current X, Y position of the fake cursor")

class PlanRequest(BaseModel):
    goal: str = Field(..., description="User high-level prompt goal")
    image: str = Field(..., description="Anonymized WebP image base64 data URL")
    unredacted_image: Optional[str] = Field(None, description="Raw unredacted image base64 data URL for testing")
    dom_snapshot: Optional[str] = Field(None, description="Simplified HTML or Accessibility Tree snapshot")
    viewport_size: Optional[ViewportSize] = Field(None, description="Viewport dimensions for coordinate scaling")
    session_id: Optional[str] = Field("default_session", description="Session ID for multi-turn state tracking")
    current_url: Optional[str] = Field(None, description="Current URL of the active tab")
    tab_info: Optional[Dict[str, Any]] = Field(default_factory=dict)

class PlanResponse(BaseModel):
    status: str = Field("in_progress", description="Plan state: in_progress, completed, failed")
    message: str = Field("", description="Explanatory text from VLM")
    steps: List[ActionStep] = Field(default_factory=list)
