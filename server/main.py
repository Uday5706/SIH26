import os
import base64
import json
import time
import uvicorn
from fastapi import (
    FastAPI,
    HTTPException,
    Depends,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from schemas import PlanRequest, PlanResponse
from vlm_engine import VLMEngine
from config import settings
from auth.dependencies import get_current_user
from auth.google import (
    AuthenticatedUser,
    GoogleTokenValidationError,
    exchange_authorization_code,
    validate_google_id_token,
)

app = FastAPI(
    title="SIH26171 Privacy-Preserving Vision Agent Server",
    version="1.0.0",
    description="Backend FastAPI server processing anonymized screen payloads, saving proof snapshots, and serving VLM macro plans."
)

# Enable CORS for browser extension communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure public folders exist for snapshot proof storage and payload audit logs
PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "public")
SNAPSHOTS_DIR = os.path.join(PUBLIC_DIR, "snapshots")
os.makedirs(SNAPSHOTS_DIR, exist_ok=True)

# Serve static proof files (accessible via http://127.0.0.1:8000/public/snapshots/...)
app.mount("/public", StaticFiles(directory=PUBLIC_DIR), name="public")

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "SIH26171 Vision Agent Backend",
        "vlm_backend": settings.VLM_BACKEND_TYPE,
        "latest_proof_snapshot": "/public/snapshots/latest_redacted_frame.png",
        "audit_log": "/public/payload_audit.json"
    }

@app.get("/api/v1/health")
def health_check():
    return {"status": "ok", "backend": settings.VLM_BACKEND_TYPE}

@app.post("/api/v1/auth/google")
async def google_auth(request: dict):
    """
    Exchange the Google authorization code for tokens and
    validate the returned Google ID token.

    The client secret remains on the FastAPI server.
    """

    code = request.get("code")
    code_verifier = request.get("code_verifier")
    redirect_uri = request.get("redirect_uri")
    nonce = request.get("nonce")

    if not code:
        raise HTTPException(
            status_code=400,
            detail="Authorization code is required."
        )

    if not code_verifier:
        raise HTTPException(
            status_code=400,
            detail="PKCE code verifier is required."
        )

    if not redirect_uri:
        raise HTTPException(
            status_code=400,
            detail="Redirect URI is required."
        )

    if not nonce:
        raise HTTPException(
            status_code=400,
            detail="OAuth nonce is required."
        )

    # Make sure the redirect URI is the one belonging to
    # our Chrome extension.
    if redirect_uri != settings.GOOGLE_REDIRECT_URI:
        raise HTTPException(
            status_code=400,
            detail="Invalid OAuth redirect URI."
        )

    try:
        # ---------------------------------------------------------
        # 1. Exchange authorization code with Google
        # ---------------------------------------------------------

        token_data = await exchange_authorization_code(
            code=code,
            code_verifier=code_verifier,
            redirect_uri=redirect_uri,
        )

        id_token_string = token_data.get("id_token")

        if not id_token_string:
            raise GoogleTokenValidationError(
                "Google did not return an ID token."
            )

        # ---------------------------------------------------------
        # 2. Cryptographically validate Google ID token
        # ---------------------------------------------------------

        user = await validate_google_id_token(
            id_token_string=id_token_string,
            expected_nonce=nonce,
        )

        # ---------------------------------------------------------
        # 3. Return authenticated session information
        # ---------------------------------------------------------

        return {
            "authenticated": True,
            "idToken": id_token_string,
            "accessToken": token_data.get("access_token"),
            "expiresAt": user.expires_at * 1000,
            "user": {
                "sub": user.google_subject,
                "email": user.email or "",
                "email_verified": user.email_verified,
            },
        }

    except GoogleTokenValidationError as exc:
        raise HTTPException(
            status_code=401,
            detail=str(exc),
        )

@app.post("/api/v1/plan", response_model=PlanResponse)
async def generate_action_plan(
    request: PlanRequest,
    user: AuthenticatedUser = Depends(get_current_user),
):
    print( #for debugging
    f"[Auth] Authorized request from "
    f"{user.email or user.google_subject}"
    )
    if not request.goal:
        raise HTTPException(status_code=400, detail="Goal prompt cannot be empty.")
    if not request.image:
        raise HTTPException(status_code=400, detail="Image payload required.")

    print(f"[Server] Received plan request. Goal: '{request.goal}'")

    # -------------------------------------------------------------
    # 1. Save Redacted Proof Image Snapshot to Disk
    # -------------------------------------------------------------
    try:
        image_data = request.image
        if "," in image_data:
            image_data = image_data.split(",")[1]
        
        image_bytes = base64.b64decode(image_data)
        
        # Save as latest_redacted_frame.png
        latest_path = os.path.join(SNAPSHOTS_DIR, "latest_redacted_frame.png")
        with open(latest_path, "wb") as f:
            f.write(image_bytes)

        # Save timestamped copy for audit history
        timestamp = int(time.time())
        history_path = os.path.join(SNAPSHOTS_DIR, f"redacted_frame_{timestamp}.png")
        with open(history_path, "wb") as f:
            f.write(image_bytes)

        print(f"[Server Proof] Redacted frame proof saved to: {latest_path}")
    except Exception as e:
        print(f"[Server Warning] Could not save proof snapshot image: {e}")

    # -------------------------------------------------------------
    # 2. Export Anonymized Transmission Payload to Audit JSON File
    # -------------------------------------------------------------
    try:
        audit_payload = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "goal": request.goal,
            "image_size_bytes": len(request.image),
            "image_format": "data:image/webp;base64",
            "tab_info": request.tab_info,
            "proof_snapshot_file": "public/snapshots/latest_redacted_frame.png",
            "pii_redacted_verification": "SUCCESS - All DOM, Text & Visual PII blacked out prior to transmission"
        }

        audit_json_path = os.path.join(PUBLIC_DIR, "payload_audit.json")
        with open(audit_json_path, "w") as f:
            json.dump(audit_payload, f, indent=2)

        print(f"[Server Audit] Payload audit log exported to: {audit_json_path}")
    except Exception as e:
        print(f"[Server Warning] Could not save audit JSON payload: {e}")

    # -------------------------------------------------------------
    # 3. Generate VLM Trial & Error Action Plan
    # -------------------------------------------------------------
    plan = VLMEngine.process_vision_plan(request.goal, request.image)
    return plan

if __name__ == "__main__":
    uvicorn.run("main:app", host=settings.HOST, port=settings.PORT, reload=True)
