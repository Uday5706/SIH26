import requests
from config import settings
from schemas import PlanResponse, ActionStep
from mock_vlm import MockVLMEngine

class VLMEngine:
    """
    VLM Integration Module
    Connects to external Ollama / vLLM instances running Qwen2-VL or Florence-2.
    Falls back gracefully to MockVLMEngine if offline.
    """

    @staticmethod
    def process_vision_plan(request_data) -> PlanResponse:
        from agent_memory import session_memory
        import json
        
        goal = request_data.goal
        base64_webp = request_data.image
        session_id = request_data.session_id
        dom = request_data.dom_snapshot or "No DOM provided"
        history = session_memory.get_history(session_id)
        
        session_memory._get_or_create_session(session_id, goal)

        loop_warning = ""
        if session_memory.is_looping(session_id):
            last_action = history[-1].get("action") if history else ""
            if last_action == "scroll":
                loop_warning = "\n[SYSTEM WARNING]: You are stuck in a SCROLL LOOP. The page is not changing or you hit the bottom. YOU MUST STOP SCROLLING. Click a different element or emit 'finish'.\n"
            else:
                print(f"[VLM Engine] Loop detected on '{last_action}'. Forcing scroll down to break loop.")
                fallback_step = ActionStep(action_type="scroll", value="down", timeout=3000)
                session_memory.record_step_execution(session_id, fallback_step, success=True)
                return PlanResponse(
                    status="in_progress",
                    message="Loop detected. Forcing scroll to find new elements.",
                    steps=[fallback_step]
                )

        if settings.VLM_BACKEND_TYPE == "mock":
            # For simplicity in mock we just pass the goal, in reality mock could use session
            return MockVLMEngine.generate_plan(goal)

        current_url = request_data.current_url or "Unknown"
        viewport = request_data.viewport_size
        if viewport and viewport.cursor_position:
            cursor_info = f", Cursor Position: (X: {viewport.cursor_position.get('x')}, Y: {viewport.cursor_position.get('y')})"
        else:
            cursor_info = ""
            
        viewport_info = f"Current URL: {current_url}\nViewport: {viewport.width}x{viewport.height}, Scroll Y: {viewport.scrollY}{cursor_info}" if viewport else f"Current URL: {current_url}\nViewport info unavailable"

        try:
            # Query local Ollama API
            url = f"{settings.OLLAMA_URL}/api/generate"
            
            prompt = (
                f"You are a web automation Vision Agent.\n"
                f"Goal: '{goal}'\n"
                f"Past Actions: {json.dumps(history)}\n"
                f"{viewport_info}\n"
                f"Current DOM Context (Simplified):\n{dom[:8000]}\n"
                f"{loop_warning}\n"
                "CRITICAL INSTRUCTIONS:\n"
                "1. State Machine (MANDATORY): You must maintain a 'roadmap' (list of steps) and a 'current_step_index'. First, evaluate 'Past Actions'. Output 'last_action_evaluation': 'Success' or 'Failed: <reason>'. If Success, increment 'current_step_index'. If Failed, DO NOT increment the pointer; instead, try a DIFFERENT element or approach.\n"
                "2. Action Strategy: If an element is a button or link, use 'click'. If you need to reveal hidden menus, use 'hover'. If you need to type text, use 'type'.\n"
                "3. Scrolling: ONLY emit 'scroll' if you need to see more of the page. NEVER scroll to find the main search bar.\n"
                "4. Task Completion: If the goal has been fully met, you MUST emit action_type: 'finish'.\n"
                "5. Action Targeting: Provide a 'target_selector' (CSS selector) for ALL 'click', 'hover', 'right_click' and 'type' actions. NEVER guess IDs. If there are MULTIPLE identical elements, provide 'coordinates': {'x': <num>, 'y': <num>} from the 'center' attribute in the DOM.\n"
                "6. Return ONLY a RAW JSON array containing EXACTLY ONE object. No markdown.\n"
                "Example: [{\"last_action_evaluation\": \"Success. Text is visible.\", \"roadmap\": [\"1. Type query\", \"2. Click search button\"], \"current_step_index\": 1, \"thought\": \"Moving to step 2.\", \"expected_outcome\": \"Search results appear.\", \"action_type\": \"click\", \"value\": \"\", \"target_selector\": \"#nav-search-submit-button\", \"text_fallback\": \"\", \"coordinates\": {\"x\": 637, \"y\": 30}}]"
            )

            clean_b64 = base64_webp
            if "," in base64_webp:
                clean_b64 = base64_webp.split(",")[1]

            payload = {
                "model": settings.OLLAMA_MODEL,
                "prompt": prompt,
                "images": [clean_b64],
                "stream": False,
                "options": {
                    "num_ctx": 8192
                }
            }

            resp = requests.post(url, json=payload, timeout=120)
            if resp.status_code == 200:
                data = resp.json()
                raw_response = data.get("response", "[]").strip()
                
                # Strip markdown code blocks if the model ignored instructions
                if raw_response.startswith("```json"):
                    raw_response = raw_response[7:]
                if raw_response.startswith("```"):
                    raw_response = raw_response[3:]
                if raw_response.endswith("```"):
                    raw_response = raw_response[:-3]
                raw_response = raw_response.strip()
                
                try:
                    steps_data = json.loads(raw_response)
                    if isinstance(steps_data, dict):
                        steps_data = [steps_data] # Wrap single object in list
                        
                    parsed_steps = []
                    for step_dict in steps_data:
                        # Handle common LLM hallucination of nested action dict
                        if "action" in step_dict and isinstance(step_dict["action"], dict):
                            action_dict = step_dict.pop("action")
                            step_dict["action_type"] = action_dict.get("type", action_dict.get("action_type", "type"))
                            if "coordinates" in action_dict and "coordinates" not in step_dict:
                                step_dict["coordinates"] = action_dict["coordinates"]
                                
                        # Handle common LLM hallucination of "action" string instead of "action_type"
                        if "action" in step_dict and "action_type" not in step_dict:
                            step_dict["action_type"] = step_dict.pop("action")
                            
                        # Handle common hallucination of "none" action type
                        if step_dict.get("action_type") == "none":
                            step_dict["action_type"] = "wait_for_mutation"
                            
                        # Handle common hallucination of "terminate" instead of "finish"
                        if step_dict.get("action_type") == "terminate":
                            step_dict["action_type"] = "finish"
                            
                        # Handle stubborn LLM 'type' on buttons with empty string
                        if step_dict.get("action_type") == "type" and not step_dict.get("value"):
                            step_dict["action_type"] = "click"
                            
                        step = ActionStep(**step_dict)
                        
                        if step.action_type in ["click", "type"] and not step.target_selector and not step.coordinates:
                            print(f"[VLM Engine] LLM Hallucinated an empty target_selector for a click/type action. Retrying.")
                            return PlanResponse(
                                status="in_progress",
                                message="Agent returned invalid action without target_selector.",
                                steps=[ActionStep(action_type="wait_for_mutation", timeout=3000)]
                            )
                            
                        # Record step in memory
                        session_memory.record_step_execution(session_id, step, success=True)
                        parsed_steps.append(step)
                        
                    # Live Log export for user
                    import os
                    try:
                        base_dir = os.path.dirname(os.path.abspath(__file__))
                        public_dir = os.path.join(base_dir, "public")
                        os.makedirs(public_dir, exist_ok=True)
                        log_path = os.path.join(public_dir, "server_responses.txt")
                        with open(log_path, "a") as f:
                            f.write(f"=== Server Response for Session {session_id} ===\n")
                            f.write(json.dumps(steps_data, indent=2) + "\n\n")
                    except Exception as e:
                        print(f"Failed to write log: {e}")
                        
                    return PlanResponse(
                        status="in_progress" if parsed_steps and parsed_steps[-1].action_type != "finish" else "completed",
                        message="VLM generated next steps.",
                        steps=parsed_steps
                    )
                except Exception as parse_e:
                    print(f"[VLM Engine] JSON parsing failed: {parse_e}. Raw: {raw_response}")
                    return PlanResponse(
                        status="in_progress",
                        message="Agent returned invalid JSON. Retrying.",
                        steps=[ActionStep(action_type="wait_for_mutation", timeout=3000)]
                    )

        except Exception as e:
            print(f"[VLM Engine] Ollama connection warning: {e}. Using Mock Engine fallback.")

        return MockVLMEngine.generate_plan(goal, session_id)
