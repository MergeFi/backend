# Plan: Fix TeamMemberSplit FK Integrity (Issue #58)

## Overview
Change `TeamMemberSplit.user` relation from `onDelete: 'CASCADE'` to `onDelete: 'RESTRICT'` to prevent silent deletion of financial splits when a user account is deleted, which currently causes stuck bounties.

## Architectural Changes
1.  **Entity Update**: Modify `src/common/entities/team-member-split.entity.ts` to change `onDelete` to `RESTRICT`.
2.  **Migration**: Create a new TypeORM migration to update the foreign key constraint.
    -   Drop the existing constraint (`FK_...`).
    -   Re-create the constraint with `ON DELETE RESTRICT`.
    -   Reference `1784272650000-EscrowFkIntegrityAndSponsorId.ts` for the established migration pattern.

## Data Flow Implications
-   **Delete Operation**: Attempting to delete a `User` referenced by a `TeamMemberSplit` will now throw a Database Foreign Key Violation exception.
-   **UX/Business Logic**: This *will* block user deletion if they are still part of an active team.
-   **Future Consideration (Soft Delete)**: Explicitly note in the PR that `RESTRICT` is a safe first step to ensure data integrity. A separate feature for soft-deletion/deactivation of team membership should be scoped later to support clean account closures.

## Risks
-   **Blocking User Deletion**: Legitimate account deletions may fail. This is intentional to prevent broken financial states, but requires documentation.
-   **Application Error Handling**: The application should catch the DB constraint violation and present a user-friendly error (e.g., "Cannot delete user, still part of an active team").

## Verification Plan
1.  **Reproduction Test**: Create a test case based on the plan in `spec.md`:
    -   Create team + splits (sum 100%).
    -   Fund bounty.
    -   Attempt `userRepo.delete(memberId)`.
    -   Verify error thrown (Database restriction).
2.  **Bounty Integrity**: Verify that even if the delete attempt is made, the bounty status remains manageable (not silent data loss).
3.  **Migration Test**: Ensure the migration applies and reverses correctly.
