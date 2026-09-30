# Engineering Grade Research

Use this before software/system/security/commercial production topics. The goal is not demo-level advice; it is production, security, and business-grade knowledge.

## Mandatory Lanes

For system design and implementation topics, search enough to cover:

- Official docs or standards.
- Reference implementation or mature open-source example.
- Security guidance, abuse cases, or bypass reports.
- Production writeup, incident, issue thread, or community discussion.
- Frontend/user experience implications when user-facing.
- Operations/commercial constraints: observability, support, compliance, cost, maintainability.
- Prior internal knowledge: query `<experience-root>` with `scripts\experience_store.py query`, then check matched old dossiers before searching from scratch.

## Output Must Answer

- What should be built?
- What fields/data are needed?
- What is the normal flow?
- What are edge cases and failure modes?
- What can users or attackers bypass?
- What should frontend validate, and what must backend enforce?
- What should never happen in production?
- How to test and monitor it?
- What is the minimum commercial-safe version?
- What should be saved as reusable knowledge for future builds?

## Account Login/Register Playbook

Use this when researching account systems, login, registration, auth, sessions, user profiles, verification, password reset, OAuth, MFA, RBAC, abuse prevention, or frontend/backend auth flows.

Search lanes:

- OWASP Authentication Cheat Sheet, Session Management Cheat Sheet, MFA guidance.
- Framework docs for auth/session/cookies/CSRF/CORS.
- Mature auth providers: Auth0, Clerk, Supabase Auth, Firebase Auth, NextAuth/Auth.js, Spring Security, Passport, Keycloak.
- GitHub issues and incident writeups about auth bypass, email verification bypass, session fixation, rate limit failure.
- UX examples for sign up, login, forgot password, MFA, error states, email/SMS verification.

Minimum fields to consider:

- `user_id`, `email`, `email_verified_at`, `phone`, `phone_verified_at`, `password_hash`, `password_updated_at`.
- `status`: pending/active/locked/disabled/deleted.
- `role` or separate RBAC tables.
- `created_at`, `updated_at`, `last_login_at`, `last_login_ip`.
- `failed_login_count`, `locked_until`, `risk_score` when needed.
- `terms_accepted_at`, `privacy_accepted_at`, `marketing_opt_in` when commercial/legal requires it.
- External identity fields for OAuth: provider, provider_user_id, linked_at.
- Session/token records: session_id, user_id, device, ip, user_agent, expires_at, revoked_at.
- Verification records: purpose, target, code_hash/token_hash, expires_at, attempts, consumed_at.

Registration logic:

- Backend must enforce uniqueness, validation, password policy, verification state, rate limits, and abuse controls.
- Email/phone verification should be required before sensitive actions when business risk requires it.
- Do not trust frontend-only validation.
- Use token/code hashing at rest where appropriate.
- Avoid account enumeration in public error messages.
- Log and monitor suspicious registration velocity, disposable domains, repeated IP/device patterns.

Login logic:

- Verify credentials on backend only.
- Rate-limit by account, IP, device, and risk signal.
- Use secure password hashing such as Argon2id/bcrypt/scrypt with current parameters.
- Use secure cookies or token storage appropriate to the app; protect against CSRF/XSS/session fixation.
- Rotate/revoke sessions on password reset, credential change, high-risk events.
- Return generic errors for invalid credentials.

Captcha/verification:

- Do not make CAPTCHA the only defense.
- Use CAPTCHA adaptively for high-risk flows: repeated failures, suspicious IP, registration bursts, password reset abuse, scraping.
- Keep backend verification mandatory; frontend display is only UX.
- Record provider result and failure mode when needed.

Frontend responsibilities:

- Clear form states, validation hints, loading, disabled duplicate submit, accessible errors, password visibility toggle, localization.
- Never expose secret logic, bypass flags, privileged role choices, or trusted verification state.
- Treat frontend validation as UX only. Backend remains source of truth.
- Handle expired verification links, locked accounts, MFA required, network failures, and session timeout.

Backend responsibilities:

- Centralize auth checks and permission checks.
- Enforce email/phone verification and status checks on protected APIs.
- Use idempotent verification and reset flows.
- Audit security-relevant events.
- Protect admin/user role changes with authorization and audit logs.
- Use transactional consistency for user creation and verification state changes.

Must not happen:

- Register/login bypass by calling APIs directly.
- Verified status settable from client input.
- Role/permission settable by public registration payload.
- Password stored or logged in plaintext.
- Verification code/token stored plaintext without a strong reason.
- Reusable or non-expiring reset/verification tokens.
- Account enumeration through errors, timing, or reset response.
- Unlimited login/registration/reset attempts.
- Session still valid after password reset or account disable.
- CORS/CSRF misconfiguration allowing cross-site abuse.

Validation/test checklist:

- API tests for direct-call bypass attempts.
- Rate-limit tests for login/register/reset/verify.
- Token expiry, single-use, replay, and consumed-token tests.
- Session revocation tests.
- Permission escalation tests.
- Frontend disabled-submit and error-state tests.
- Audit log checks for security events.
- Monitoring alerts for spikes in failures, registrations, resets, and verification attempts.

## Commercialization Bar

For business-ready systems, also collect:

- Terms/privacy consent requirements.
- Support and recovery flows.
- Abuse moderation/lockout handling.
- Admin operations and audit logs.
- Data retention and deletion.
- Metrics: conversion, verification completion, login success/failure, abuse rate.
