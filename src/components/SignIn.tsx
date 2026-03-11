import { useState } from "react";
import { logger } from "../services/logger";

type Props = {
  signIn: () => Promise<void>;
};

export const SignIn = ({ signIn }: Props) => {
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    setLoading(true);
    try {
      await signIn();
    } catch (err) {
      logger.error("Sign in failed", err);
      setLoading(false);
    }
  };

  return (
    <div className="signin-container">
      <div className="signin-card">
        {/* Logo/Icon Section */}
        <div className="signin-icon">
          <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
            {/* Background Circle */}
            <circle cx="40" cy="40" r="40" fill="url(#gradient)" />
            {/* Checkmark */}
            <path
              d="M25 42L35 52L57 30"
              stroke="white"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <defs>
              <linearGradient id="gradient" x1="0" y1="0" x2="80" y2="80">
                <stop offset="0%" stopColor="#0078d4" />
                <stop offset="100%" stopColor="#005a9e" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* Title Section */}
        <div className="signin-header">
          <h1>Microsoft To Do</h1>
          <p className="signin-subtitle">for Linux</p>
        </div>

        {/* Description */}
        <div className="signin-description">
          <p>
            Stay organized and manage your day with Microsoft To Do. 
            Sign in to sync your tasks across all your devices.
          </p>
        </div>

        {/* Sign In Button */}
        <button
          className="signin-button"
          onClick={handleSignIn}
          disabled={loading}
        >
          {loading ? (
            <>
              <span className="signin-spinner"></span>
              <span>Signing in...</span>
            </>
          ) : (
            <>
              <svg width="21" height="21" viewBox="0 0 21 21" fill="none">
                <path
                  d="M0 10.5h9V21h-9V10.5z"
                  fill="#f25022"
                />
                <path
                  d="M0 0h9v9H0V0z"
                  fill="#7fba00"
                />
                <path
                  d="M11 0h9v9h-9V0z"
                  fill="#00a4ef"
                />
                <path
                  d="M11 10.5h9V21h-9V10.5z"
                  fill="#ffb900"
                />
              </svg>
              <span>Sign in with Microsoft</span>
            </>
          )}
        </button>

        {/* Info Section */}
        <div className="signin-info">
          <p>
            <span className="info-icon">🔒</span>
            Your credentials are never stored in this app. 
            Authentication is handled securely by Microsoft.
          </p>
        </div>

        {/* Footer */}
        <div className="signin-footer">
          <p>This is an unofficial open-source client for Microsoft To Do.</p>
        </div>
      </div>

      {/* Background Pattern */}
      <div className="signin-background">
        <div className="background-circle background-circle-1"></div>
        <div className="background-circle background-circle-2"></div>
        <div className="background-circle background-circle-3"></div>
      </div>
    </div>
  );
};