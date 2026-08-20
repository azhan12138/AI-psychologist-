# Security and privacy

This repository is a public, sanitized product subset. It intentionally excludes API keys, `.env.local`, raw recordings, conversation archives, local model weights, logs, and deployment credentials.

## Configure secrets safely

1. Copy `.env.example` to `.env.local`.
2. Add credentials only to `.env.local` or your deployment platform's server-side secret manager.
3. Never prefix a private credential with `NEXT_PUBLIC_`.
4. Before publishing changes, check that no secret or identifiable conversation data is staged.

The browser calls same-origin API routes; model and speech credentials are read only by server-side code. Microphone audio is processed locally by the optional ASR route. When neural TTS is enabled, only generated reply text is sent to that provider.

## Report a vulnerability

Please use GitHub's private security advisory workflow instead of opening a public issue containing sensitive details.
