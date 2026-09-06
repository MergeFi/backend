# Task List: Fix TeamMemberSplit FK Integrity

- [X] **Phase 1: Setup & Reproduce**
    - [X] Create a new test file `test/team-split-integrity.e2e-spec.ts`.
    - [X] Implement the reproduction test case defined in `spec.md` (create team, fund bounty, attempt user deletion, assert rejection).
    - [X] Run the test to confirm it fails as expected (i.e., the user is deleted and splits are broken, or the delete succeeds but causes issues later).

- [X] **Phase 2: Entity Change**
    - [X] Modify `src/common/entities/team-member-split.entity.ts`: change `onDelete: 'CASCADE'` to `onDelete: 'RESTRICT'` in `user` relation.
    - [X] Verify that TypeScript compiles correctly (`npm run build`).

- [X] **Phase 3: Database Migration**
    - [X] Generate a new migration: `npm run migration:generate -- src/database/migrations/UpdateTeamMemberSplitOnDelete`
    - [X] Edit the generated migration file to ensure it correctly drops and recreates the foreign key constraint with `ON DELETE RESTRICT`.
    - [X] Run the migration: `npm run migration:run`.
    - [X] Verify database schema (e.g., using `psql` or TypeORM CLI) to confirm the new FK constraint exists.

- [X] **Phase 4: Verify Fix**
    - [X] Run the reproduction test created in Phase 1 again.
    - [X] Verify the test now passes: the deletion should be blocked by the DB constraint.
    - [X] Ensure `npm run test` and `npm run test:e2e` pass.

- [X] **Phase 5: Cleanup & PR Preparation**
    - [X] Add explicit commentary/documentation in the PR description regarding the design decision to use `RESTRICT` and the necessity of future soft-delete functionality.
    - [X] Final code review: ensure code style matches existing conventions.
    - [X] Verify `npm run lint`.
