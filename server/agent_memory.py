import time
from typing import List, Dict, Any, Optional
from schemas import ActionStep, PlanResponse

class AgentSessionMemory:
    """
    Server-side Agent Session Memory
    Maintains multi-turn action history, trial-and-error retries, and dynamic page state context.
    """

    def __init__(self):
        self.history: List[Dict[str, Any]] = []
        self.failed_selectors: Dict[str, int] = {}
        self.current_turn: int = 0
        self.last_goal: str = ""

    def reset_if_new_goal(self, goal: str):
        if goal != self.last_goal:
            self.history = []
            self.failed_selectors = {}
            self.current_turn = 0
            self.last_goal = goal

    def record_step_execution(self, step: ActionStep, success: bool = True, error: Optional[str] = None):
        self.current_turn += 1
        record = {
            "turn": self.current_turn,
            "action": step.action_type,
            "target": step.target_selector,
            "success": success,
            "timestamp": time.time()
        }

        if not success and step.target_selector:
            count = self.failed_selectors.get(step.target_selector, 0) + 1
            self.failed_selectors[step.target_selector] = count
            record["error"] = error

        self.history.append(record)

    def get_trial_and_error_fallback(self, step: ActionStep) -> ActionStep:
        """
        Generates alternative selector / action fallback if target previously failed.
        """
        if step.target_selector and self.failed_selectors.get(step.target_selector, 0) > 0:
            # Generate fallback selector or fuzzy text match
            print(f"[Agent Memory] Target '{step.target_selector}' failed previously. Applying trial-and-error fallback.")
            return ActionStep(
                action_type=step.action_type,
                target_selector=step.text_fallback or step.target_selector,
                text_fallback=step.text_fallback,
                value=step.value,
                coordinates=step.coordinates,
                timeout=step.timeout
            )
        return step

session_memory = AgentSessionMemory()
