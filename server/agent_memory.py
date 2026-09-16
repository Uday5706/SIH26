import time
from typing import List, Dict, Any, Optional
from schemas import ActionStep, PlanResponse

class AgentSessionMemory:
    """
    Server-side Agent Session Memory
    Maintains multi-turn action history, trial-and-error retries, and dynamic page state context.
    """

    def __init__(self):
        self.sessions: Dict[str, Dict[str, Any]] = {}

    def _get_or_create_session(self, session_id: str, goal: str) -> Dict[str, Any]:
        if session_id not in self.sessions:
            self.sessions[session_id] = {
                "history": [],
                "failed_selectors": {},
                "current_turn": 0,
                "last_goal": goal
            }
        else:
            # Reset if goal changed within same session ID
            if self.sessions[session_id]["last_goal"] != goal:
                self.sessions[session_id] = {
                    "history": [],
                    "failed_selectors": {},
                    "current_turn": 0,
                    "last_goal": goal
                }
        return self.sessions[session_id]

    def record_step_execution(self, session_id: str, step: ActionStep, success: bool = True, error: Optional[str] = None):
        session = self.sessions.get(session_id)
        if not session:
            return
        
        session["current_turn"] += 1
        record = {
            "turn": session["current_turn"],
            "action": step.action_type,
            "target": step.target_selector,
            "expected_outcome": step.expected_outcome,
            "value": step.value,
            "coordinates": step.coordinates,
            "success": success,
            "timestamp": time.time()
        }

        if not success and step.target_selector:
            count = session["failed_selectors"].get(step.target_selector, 0) + 1
            session["failed_selectors"][step.target_selector] = count
            record["error"] = error

        session["history"].append(record)

    def get_trial_and_error_fallback(self, session_id: str, step: ActionStep) -> ActionStep:
        """
        Generates alternative selector / action fallback if target previously failed.
        """
        session = self.sessions.get(session_id)
        if not session:
            return step

        if step.target_selector and session["failed_selectors"].get(step.target_selector, 0) > 0:
            print(f"[Agent Memory] Target '{step.target_selector}' failed previously in session {session_id}. Applying trial-and-error fallback.")
            return ActionStep(
                action_type=step.action_type,
                target_selector=step.text_fallback or step.target_selector,
                text_fallback=step.text_fallback,
                value=step.value,
                coordinates=step.coordinates,
                timeout=step.timeout
            )
        return step
    
    def get_history(self, session_id: str) -> List[Dict[str, Any]]:
        session = self.sessions.get(session_id)
        if not session:
            return []
        
        # Clean history for VLM context to prevent LLM hallucination on long floats
        clean_history = []
        for r in session["history"]:
            clean_record = {k: v for k, v in r.items() if k != "timestamp" and v is not None}
            clean_history.append(clean_record)
            
        return clean_history

    def is_looping(self, session_id: str) -> bool:
        session = self.sessions.get(session_id)
        if not session or len(session["history"]) < 3:
            return False
        
        recent = session["history"][-3:]
        first = recent[0]
        
        # Special case: If action is "scroll" 3 times in a row, it's a loop regardless of target hallucination
        if all(r.get("action") == "scroll" for r in recent):
            return True
            
        # Standard case: Same action AND (same target OR same coordinates)
        if all(r.get("action") == first.get("action") for r in recent):
            # If coordinates are identical (and not None) across all 3
            if first.get("coordinates") and all(r.get("coordinates") == first.get("coordinates") for r in recent):
                return True
            # If target is identical (and not empty) across all 3
            if first.get("target") and all(r.get("target") == first.get("target") for r in recent):
                return True
                
        return False

session_memory = AgentSessionMemory()
