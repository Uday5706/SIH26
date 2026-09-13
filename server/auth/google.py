from dataclasses import dataclass
from typing import Optional

import httpx
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from config import settings


@dataclass
class AuthenticatedUser:
    google_subject: str
    email: Optional[str]
    email_verified: bool
    client_id: str
    scopes: set[str]
    expires_at: int


class GoogleTokenValidationError(Exception):
    """Raised when Google authentication or ID token validation fails."""
    pass


async def exchange_authorization_code(
    code: str,
    code_verifier: str,
    redirect_uri: str,
) -> dict:

    if not code:
        raise GoogleTokenValidationError(
            "Authorization code is missing."
        )

    if not code_verifier:
        raise GoogleTokenValidationError(
            "PKCE code verifier is missing."
        )

    if not settings.GOOGLE_CLIENT_SECRET:
        raise GoogleTokenValidationError(
            "Google OAuth client secret is not configured on the server."
        )

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:

            response = await client.post(
                settings.GOOGLE_TOKEN_ENDPOINT,
                data={
                    "code": code,
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": code_verifier,
                },
            )

    except httpx.RequestError as exc:
        raise GoogleTokenValidationError(
            "Could not contact Google token service."
        ) from exc

    if response.status_code != 200:
        try:
            error_data = response.json()
            error_description = (
                error_data.get("error_description")
                or error_data.get("error")
                or "Unknown Google OAuth error."
            )
        except Exception:
            error_description = "Unknown Google OAuth error."

        raise GoogleTokenValidationError(
            f"Google token exchange failed: {error_description}"
        )

    token_data = response.json()

    if not token_data.get("id_token"):
        raise GoogleTokenValidationError(
            "Google did not return an ID token."
        )

    return token_data


async def validate_google_id_token(
    id_token_string: str,
    expected_nonce: Optional[str] = None,
) -> AuthenticatedUser:

    if not id_token_string:
        raise GoogleTokenValidationError(
            "ID token is missing."
        )

    try:
        # google-auth downloads Google's public signing keys and
        # cryptographically verifies the JWT signature, issuer,
        # audience, and expiration.
        claims = id_token.verify_oauth2_token(
            id_token_string,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )

    except ValueError as exc:
        raise GoogleTokenValidationError(
            "Google ID token validation failed."
        ) from exc

    # -------------------------------------------------------------
    # 1. Verify issuer
    # -------------------------------------------------------------

    issuer = claims.get("iss")

    if issuer not in {
        "https://accounts.google.com",
        "accounts.google.com",
    }:
        raise GoogleTokenValidationError(
            "Invalid Google ID token issuer."
        )

    # -------------------------------------------------------------
    # 2. Verify audience
    # -------------------------------------------------------------

    audience = claims.get("aud")

    if audience != settings.GOOGLE_CLIENT_ID:
        raise GoogleTokenValidationError(
            "Google ID token was not issued for this application."
        )

    # -------------------------------------------------------------
    # 3. Verify subject
    # -------------------------------------------------------------

    subject = claims.get("sub")

    if not subject:
        raise GoogleTokenValidationError(
            "ID token does not contain a Google user subject."
        )

    # -------------------------------------------------------------
    # 4. Verify expiration
    # -------------------------------------------------------------

    try:
        expires_at = int(claims["exp"])
    except (KeyError, TypeError, ValueError) as exc:
        raise GoogleTokenValidationError(
            "ID token does not contain a valid expiration."
        ) from exc

    # -------------------------------------------------------------
    # 5. Verify nonce when supplied
    # -------------------------------------------------------------

    if expected_nonce is not None:

        token_nonce = claims.get("nonce")

        if not token_nonce or token_nonce != expected_nonce:
            raise GoogleTokenValidationError(
                "Google ID token nonce validation failed."
            )

    # -------------------------------------------------------------
    # 6. Parse scopes
    # -------------------------------------------------------------

    raw_scope = claims.get("scope", "")

    scopes = set(raw_scope.split())

    # The ID token normally does not contain OAuth scopes.
    # The authorization-code exchange response does, so scope
    # checking is handled by the authentication endpoint.

    # -------------------------------------------------------------
    # 7. Construct authenticated user
    # -------------------------------------------------------------

    return AuthenticatedUser(
        google_subject=subject,
        email=claims.get("email"),
        email_verified=(
            claims.get("email_verified") is True
            or str(
                claims.get("email_verified", "")
            ).lower() == "true"
        ),
        client_id=audience,
        scopes=scopes,
        expires_at=expires_at,
    )