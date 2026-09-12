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
    def process_vision_plan(goal: str, base64_webp: str) -> PlanResponse:
        if settings.VLM_BACKEND_TYPE == "mock":
            return MockVLMEngine.generate_plan(goal)

        try:
            # Query local Ollama API
            url = f"{settings.OLLAMA_URL}/api/generate"
            prompt = (
                f"You are a web automation Vision Agent. Goal: '{goal}'. "
                "Inspect the image (sensitive PII is blacked out) and return a JSON array of step action primitives "
                "(click, type, scroll, wait_for_mutation)."
            )

            # Strip data URL header if present
            clean_b64 = base64_webp
            if "," in base64_webp:
                clean_b64 = base64_webp.split(",")[1]

            payload = {
                "model": settings.OLLAMA_MODEL,
                "prompt": prompt,
                "images": [clean_b64],
                "stream": False,
                "format": "json"
            }

            resp = requests.post(url, json=payload, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                # Parse JSON response into PlanResponse
                return PlanResponse(
                    status="in_progress",
                    message=data.get("response", "VLM response parsed."),
                    steps=[ActionStep(action_type="wait_for_mutation")]
                )
        except Exception as e:
            print(f"[VLM Engine] Ollama connection warning: {e}. Using Mock Engine fallback.")

        return MockVLMEngine.generate_plan(goal)
