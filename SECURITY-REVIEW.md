# Sketchplay API Security Review

**Review date:** 2026-10-08  
**Scope:** Static, read-only review of API implementation and API security tests in `sketchplay-node`.  
**Actions:** No source files in `sketchplay-node` were changed. No live endpoints or `.env` files were accessed.

## Findings

### 1. Hard-coded master OTP can authenticate phone accounts

- **Severity:** High
- **Confidence:** 10/10
- **Location:** `sketchplay-node/src/phone-login/phone-login.service.ts:125`; exposed through `src/phone-login/phone-login.controller.ts:23-56`
- **Impact:** A caller who knows a registered phone number can request an OTP, receive the `otpRequestId` in the response, and submit the hard-coded master code to verify the request without receiving the SMS. Successful verification proceeds to load the user and issue authentication tokens (`phone-login.service.ts:132-145`, `phone-login.controller.ts:84-89`).
- **Evidence:** The service contains a master-code acceptance path, and `phone-login.service.spec.ts:182-190` explicitly expects that code to authenticate.
- **Recommendation:** Remove the master-code bypass from production authentication and require the actual issued OTP. If a test bypass is needed, confine it to isolated test configuration and ensure it cannot be enabled in production.
- **Suggested safe test:** With a test account and stubbed SMS service, verify that an incorrect code—including the former master code—cannot create an authenticated session.

### 2. API response logger records credentials

- **Severity:** High
- **Confidence:** 9/10
- **Location:** `sketchplay-node/src/main.ts:165`
- **Impact:** The response logger records raw bodies for `POST`, `PUT`, `DELETE`, and `PATCH` requests. Organization-token creation returns a plaintext token (`src/org-token/org-token.service.ts:155`), and phone login returns session and refresh tokens (`src/phone-login/phone-login.controller.ts:84-89`). These credentials can therefore be copied from production logs by anyone with log access.
- **Evidence:** The response body is serialized without redaction. The request-body scrubber does not redact response bodies; production Winston configuration writes logs to rotating files.
- **Recommendation:** Do not log response bodies. If response details are essential, redact secrets recursively, including access, refresh, session, organization, and API tokens.
- **Suggested safe test:** Pass synthetic credentials through a captured logger and assert that no token value appears in emitted logs.

## Security test coverage

The phone-login unit tests currently codify acceptance of the master OTP. The reviewed API tests do not verify that a caller without the delivered code cannot obtain a session, and do not verify that credentials are excluded from logs.

Add non-production tests using a test database, fake account, and stubbed SMS and logger. Do not exercise production accounts or live endpoints.

## Not assessed

- CORS and cookie settings depend on deployment configuration.
- TLS and reverse-proxy behavior depend on deployment configuration.
- Access controls for production log readers were not available for this static review.

## Handling note

This report is stored in `sketchplay-qa-agent` as requested. That directory also contains `.auth` browser storage-state files, which may hold session cookies or tokens. Do not distribute the directory as a bundle; share only this report through an approved access-controlled channel.
