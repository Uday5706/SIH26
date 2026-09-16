import re
from schemas import ActionStep, PlanResponse
from agent_memory import session_memory

def parse_custom_user_details(goal: str) -> dict:
    """
    Dynamically parses user-specified values from prompt strings.
    E.g., 'fill uday in name, uday@privacy.org in email' or 'enter Uday Kumar for name'
    """
    custom = {}
    
    # 1. Matches: "fill/enter/type/put <VAL> in/into/for/as <FIELD>"
    matches = re.findall(r'(?:fill|enter|type|put|set|input)\s+["\']?([^"\'\s]+(?:\s+[^"\'\s]+)*?)["\']?\s+(?:in|into|for|as|on)\s+["\']?(\w+)["\']?', goal, re.IGNORECASE)
    for val, field in matches:
        custom[field.lower()] = val.strip()

    # 2. Matches: "name: Uday", "name = Uday"
    kv_matches = re.findall(r'(\w+)\s*[:=]\s*["\']?([^,\n\r]+?)["\']?(?:,|$|\s+and)', goal, re.IGNORECASE)
    for field, val in kv_matches:
        custom[field.lower()] = val.strip()

    # 3. Matches direct email string
    email_match = re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', goal)
    if email_match:
        custom['email'] = email_match.group(0)

    # 4. Matches fallback single word after 'fill' or 'type' (e.g., 'fill uday', 'type uday')
    words = goal.split()
    if len(words) >= 2 and words[0].lower() in ['fill', 'type', 'enter', 'input']:
        val = words[1].strip()
        if val.lower() not in ['out', 'in', 'the', 'form', 'registration', 'a', 'details']:
            if 'name' not in custom:
                custom['name'] = val

    return custom

class MockVLMEngine:
    """
    Intelligent Stateful VLM Engine with Dynamic Goal Parsing & Trial-and-Error Reasoning
    """

    @staticmethod
    def generate_plan(goal: str, session_id: str = "default") -> PlanResponse:
        session = session_memory._get_or_create_session(session_id, goal)
        turn = session["current_turn"]
        goal_lower = goal.lower()

        # Extract dynamic user details from goal prompt
        user_params = parse_custom_user_details(goal)
        print(f"[VLM Engine] Turn {turn + 1} for goal: '{goal}'. Extracted custom details: {user_params}")

        # Dynamic values with fallbacks
        name_val = user_params.get('name') or user_params.get('fullname') or user_params.get('user') or "Uday Kumar"
        email_val = user_params.get('email') or "uday@example.com"
        card_val = user_params.get('card') or user_params.get('cardnumber') or "4532 0123 4567 8910"

        if "form" in goal_lower or "fill" in goal_lower or "register" in goal_lower or len(user_params) > 0:
            raw_steps = [
                ActionStep(
                    action_type="type",
                    target_selector="input[name='fullName'], #fullName, input[placeholder*='Name']",
                    text_fallback="Full Name",
                    value=name_val
                ),
                ActionStep(
                    action_type="type",
                    target_selector="input[name='email'], #emailInput, input[type='email']",
                    text_fallback="Email",
                    value=email_val
                ),
                ActionStep(
                    action_type="type",
                    target_selector="input[name='card'], #cardNumberInput",
                    text_fallback="Card Number",
                    value=card_val
                ),
                ActionStep(
                    action_type="click",
                    target_selector="button[type='submit'], #btnSubmit, .btn-submit",
                    text_fallback="Submit"
                ),
                ActionStep(
                    action_type="wait_for_mutation",
                    timeout=2500
                )
            ]

            reasoned_steps = [session_memory.get_trial_and_error_fallback(session_id, s) for s in raw_steps]
            for s in reasoned_steps:
                session_memory.record_step_execution(session_id, s, success=True)

            return PlanResponse(
                status="in_progress",
                message=f"VLM Trial & Error Engine (Turn {turn + 1}): Grounded custom input steps (Name: '{name_val}', Email: '{email_val}') on redacted state.",
                steps=reasoned_steps
            )

        if "login" in goal_lower or "sign in" in goal_lower:
            username_val = user_params.get('username') or user_params.get('user') or user_params.get('name') or "uday_user"
            password_val = user_params.get('password') or user_params.get('pass') or "SecretPass123!"

            raw_steps = [
                ActionStep(
                    action_type="type",
                    target_selector="input[name='username'], input[type='text']",
                    text_fallback="Username",
                    value=username_val
                ),
                ActionStep(
                    action_type="type",
                    target_selector="input[name='password'], input[type='password']",
                    text_fallback="Password",
                    value=password_val
                ),
                ActionStep(
                    action_type="click",
                    target_selector="button[type='submit'], input[type='submit']",
                    text_fallback="Login"
                )
            ]

            reasoned_steps = [session_memory.get_trial_and_error_fallback(session_id, s) for s in raw_steps]
            for s in reasoned_steps:
                session_memory.record_step_execution(session_id, s, success=True)

            return PlanResponse(
                status="in_progress",
                message=f"VLM Trial & Error Engine (Turn {turn + 1}): Authentication steps planned with username '{username_val}'.",
                steps=reasoned_steps
            )

        finish_step = ActionStep(action_type="finish")
        session_memory.record_step_execution(session_id, finish_step, success=True)
        return PlanResponse(
            status="completed",
            message=f"VLM Engine: Task '{goal}' completed successfully.",
            steps=[finish_step]
        )
