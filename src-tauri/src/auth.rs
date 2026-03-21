use oauth2::{
  AuthorizationCode, AuthUrl, ClientId, CsrfToken,
  PkceCodeChallenge, PkceCodeVerifier, RedirectUrl,
  Scope, TokenUrl,
};
use oauth2::basic::BasicClient;
use std::sync::Mutex;
use tiny_http::Server;
use url::Url;

/// Prevents concurrent auth flows from racing each other.
static AUTH_IN_PROGRESS: Mutex<bool> = Mutex::new(false);

pub fn build_oauth_client(client_id: String) -> BasicClient {
  BasicClient::new(
    ClientId::new(client_id),
    None,
    AuthUrl::new("https://login.microsoftonline.com/common/oauth2/v2.0/authorize".into()).unwrap(),
    Some(TokenUrl::new("https://login.microsoftonline.com/common/oauth2/v2.0/token".into()).unwrap()),
  )
  .set_redirect_uri(RedirectUrl::new("http://localhost:53682/callback".into()).unwrap())
}

/// Runs the full OAuth 2.0 PKCE browser flow. Blocks until the user completes sign-in
/// or the 5-minute timeout elapses. Returns both the authorization code and the PKCE
/// verifier together so no global state is needed between the two PKCE steps.
pub fn start_auth_flow(client_id: String) -> Result<(AuthorizationCode, PkceCodeVerifier), String> {
  // Prevent concurrent auth flows — a second call would overwrite the PKCE verifier
  {
    let mut in_progress = AUTH_IN_PROGRESS
      .lock()
      .map_err(|_| "Auth state mutex poisoned — please restart the application".to_string())?;
    if *in_progress {
      return Err("Another sign-in is already in progress".to_string());
    }
    *in_progress = true;
  }

  // Wrap the rest in a closure so we can always release the lock on exit
  let result = (|| {
    let client = build_oauth_client(client_id);

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();

  // CSRF token intentionally unused: PKCE already prevents authorization code
  // interception, and the redirect is bound to 127.0.0.1 (no cross-site risk).
  let (auth_url, _csrf) = client
    .authorize_url(CsrfToken::new_random)
    .add_scope(Scope::new("Tasks.ReadWrite".into()))
    .add_scope(Scope::new("Tasks.Read".into()))
    .add_scope(Scope::new("User.Read".into()))
    .add_scope(Scope::new("offline_access".into()))
    .add_extra_param("prompt", "select_account")
    .set_pkce_challenge(pkce_challenge)
    .url();

  open::that(auth_url.to_string()).map_err(|e| e.to_string())?;

  let server = Server::http("127.0.0.1:53682").map_err(|e| e.to_string())?;
  // Wait up to 5 minutes for the user to complete sign-in
  let request = server
    .recv_timeout(std::time::Duration::from_secs(300))
    .map_err(|e| format!("Auth callback error: {e}"))?
    .ok_or("Sign-in timed out — no response received within 5 minutes")?;

  let url = Url::parse(&format!("http://localhost{}", request.url()))
    .map_err(|e| e.to_string())?;

  let code = url
    .query_pairs()
    .find(|(k, _)| k == "code")
    .map(|(_, v)| v.to_string())
    .ok_or("No code returned")?;

  let html = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Microsoft To Do for Linux</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
    background: #f5f5f5;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    color: #333;
    overflow: hidden;
  }
  .card {
    background: #fff;
    border-radius: 16px;
    padding: 48px 40px;
    max-width: 420px;
    width: 90%;
    text-align: center;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);
    position: relative;
    z-index: 1;
    animation: fadeIn 0.4s ease-out;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .icon {
    margin-bottom: 24px;
  }
  .checkmark-circle {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: linear-gradient(135deg, #0078d4, #005a9e);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .checkmark-circle svg {
    animation: drawCheck 0.5s ease-out 0.3s both;
  }
  @keyframes drawCheck {
    from { stroke-dashoffset: 48; opacity: 0; }
    to { stroke-dashoffset: 0; opacity: 1; }
  }
  .checkmark-circle svg polyline {
    stroke-dasharray: 48;
    stroke-dashoffset: 48;
    animation: drawCheck 0.5s ease-out 0.3s both;
  }
  h1 {
    font-size: 22px;
    font-weight: 600;
    margin-bottom: 4px;
    color: #1a1a1a;
  }
  .subtitle {
    font-size: 13px;
    color: #0078d4;
    font-weight: 500;
    letter-spacing: 0.5px;
    margin-bottom: 20px;
  }
  .message {
    font-size: 15px;
    color: #555;
    line-height: 1.5;
    margin-bottom: 24px;
  }
  .hint {
    font-size: 13px;
    color: #888;
  }
  .bg { position: fixed; inset: 0; z-index: 0; overflow: hidden; }
  .bg-circle {
    position: absolute;
    border-radius: 50%;
    opacity: 0.06;
    background: #0078d4;
  }
  .bg-circle-1 { width: 400px; height: 400px; top: -120px; right: -100px; }
  .bg-circle-2 { width: 300px; height: 300px; bottom: -80px; left: -60px; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <div class="checkmark-circle">
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
          <polyline points="10,19 16,25 27,13" stroke="white" stroke-width="3.5"
            stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </div>
    </div>
    <h1>Microsoft To Do</h1>
    <p class="subtitle">for Linux</p>
    <p class="message">You've signed in successfully.<br>You can close this tab and return to the app.</p>
    <p class="hint">This window will try to close automatically.</p>
  </div>
  <div class="bg">
    <div class="bg-circle bg-circle-1"></div>
    <div class="bg-circle bg-circle-2"></div>
  </div>
  <script>setTimeout(function(){ window.close(); }, 3000);</script>
</body>
</html>"#;

  let response = tiny_http::Response::from_string(html)
    .with_header("Content-Type: text/html; charset=utf-8".parse::<tiny_http::Header>()
      .expect("static header string must parse"));
  request.respond(response).ok();

  Ok((AuthorizationCode::new(code), pkce_verifier))
  })(); // end of inner closure

  // Always release the auth-in-progress lock.
  // On a poisoned mutex (a panic occurred while holding it), recover the guard
  // so we can clear the flag and unblock future auth attempts.
  *AUTH_IN_PROGRESS.lock().unwrap_or_else(|e| e.into_inner()) = false;

  result
}

