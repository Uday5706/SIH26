const GOOGLE_CLIENT_ID =
  '390639826881-0obrs7o2o8smin06jnbtvu46ci975b5r.apps.googleusercontent.com';

const GOOGLE_AUTH_ENDPOINT =
  'https://accounts.google.com/o/oauth2/v2/auth';

const SCOPES = 'openid email profile';

function randomString(length = 64) {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);

  return Array.from(
    randomValues,
    (value) => chars[value % chars.length]
  ).join('');
}

async function createCodeChallenge(codeVerifier) {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest('SHA-256', data);

  const bytes = new Uint8Array(digest);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Starts Google OAuth using Authorization Code + PKCE.
 *
 * The extension only obtains the authorization code.
 * FastAPI will exchange the code with Google and validate
 * the returned ID token using the Web Application client secret.
 */
export async function loginWithGoogle(serverUrl) {
  if (!serverUrl) {
    throw new Error('Server URL is required for Google authentication.');
  }

  const codeVerifier = randomString(64);
  const codeChallenge = await createCodeChallenge(codeVerifier);

  const state = randomString(32);
  const nonce = randomString(32);

  const redirectUri = chrome.identity.getRedirectURL();

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account'
  });

  const authorizationUrl =
    `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;

  console.log('[Auth] Params:', Object.fromEntries(params.entries()));

  console.log('[Auth] Authorization URL:', authorizationUrl);

  console.log('[Auth] Starting Google OAuth flow...');
  console.log('[Auth] Redirect URI:', redirectUri);

  const redirectResponse = await chrome.identity.launchWebAuthFlow({
    url: authorizationUrl,
    interactive: true
  });

  if (!redirectResponse) {
    throw new Error('Google authentication was cancelled.');
  }

  const callbackUrl = new URL(redirectResponse);

  const returnedState = callbackUrl.searchParams.get('state');
  const authorizationCode = callbackUrl.searchParams.get('code');
  const error = callbackUrl.searchParams.get('error');
  const errorDescription =
    callbackUrl.searchParams.get('error_description');

  if (error) {
    throw new Error(
      `Google OAuth error: ${error}${errorDescription ? ` - ${errorDescription}` : ''}`
    );
  }

  if (!returnedState || returnedState !== state) {
    throw new Error('OAuth state validation failed.');
  }

  if (!authorizationCode) {
    throw new Error('Authorization code was not returned by Google.');
  }

  /*
   * Send the authorization code to FastAPI.
   *
   * FastAPI will:
   * 1. Exchange code with Google
   * 2. Use the Web OAuth client secret
   * 3. Validate the Google ID token
   * 4. Return authenticated user information
   */
  const response = await fetch(
    `${serverUrl.replace(/\/$/, '')}/api/v1/auth/google`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: authorizationCode,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        nonce: nonce
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Authentication server rejected login: ${response.status} ${errorText}`
    );
  }

  const authData = await response.json();

  if (!authData.authenticated) {
    throw new Error('Google authentication was not accepted by the server.');
  }

  if (!authData.idToken) {
    throw new Error('Authentication server did not return an ID token.');
  }

  /*
   * Store the authenticated session in extension session storage.
   */
  await chrome.storage.session.set({
    auth: authData
  });

  console.log('[Auth] Google login successful:', authData.user?.email);

  return authData;
}


export async function getAuthState() {
  const result = await chrome.storage.session.get('auth');
  const auth = result.auth;

  if (!auth || !auth.idToken) {
    return {
      authenticated: false,
      user: null
    };
  }

  if (auth.expiresAt && auth.expiresAt <= Date.now()) {
    await chrome.storage.session.remove('auth');

    return {
      authenticated: false,
      user: null
    };
  }

  return auth;
}


export async function getIdToken() {
  const auth = await getAuthState();

  if (!auth.authenticated || !auth.idToken) {
    throw new Error('User is not authenticated.');
  }

  return auth.idToken;
}


export async function logout() {
  await chrome.storage.session.remove('auth');

  return {
    authenticated: false,
    user: null
  };
}