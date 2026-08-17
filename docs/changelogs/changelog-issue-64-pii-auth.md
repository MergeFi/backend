# Pull Request: PII Exposure Fix (Issue #64)

## Description
This PR secures the `GET /users` and `GET /users/:id` endpoints to prevent PII enumeration.

## Changes
- **Security:** Added `JwtAuthGuard` to `GET /users` and `GET /users/:id` to require valid authentication.
- **Data Protection:** Created `PublicUserDto` and `toPublicUser` mapper to strip sensitive fields (like `email`) before they reach the HTTP response, ensuring a public-safe shape.
- **Refactoring:** Refactored `UsersService` to use the new `toPublicUser` mapper, while maintaining compatibility with internal operations via `findOneRaw`.
- **Testing:** Added E2E tests in `test/users.e2e-spec.ts` to assert that unauthenticated requests are rejected (receiving 403 Forbidden).

## Verification Steps
- Run `npm run test:e2e` and confirm that unauthenticated access to user endpoints is denied.
- Run `npm run build` to verify no type or compilation errors.
- Manual inspection of API responses for authenticated users to confirm `email` is absent.
