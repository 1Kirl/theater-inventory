# Theater Inventory Tracker — User Flows

## 1. First-Time User — Create an Organization

1. User opens the application.
2. User selects Sign Up.
3. User enters:
   - User ID
   - Display Name
   - Password
   - Confirm Password
4. Account is created.
5. User is routed to Organization Selection.
6. User has no organizations, so the empty state is shown.
7. User selects Create Organization.
8. User enters organization name and optional description.
9. The client generates the organization ID and a join code with `crypto.getRandomValues()`, then
   commits one batched write containing the organization, the creator's membership, the admin
   settings, and the join code. Security Rules validate the four documents as a unit.
10. Current user becomes the first Admin, because the organization names them in `admin_uid`.
    Their membership starts empty — no teams, no permissions — which is what they fall back to if
    administration is ever transferred away.
11. The generated join code is now the organization's active code.
12. Organization Created screen shows the join code.
13. User selects Enter Organization.
14. Dashboard opens for the new organization.

## 2. First-Time User — Join an Existing Organization

1. User creates a personal account or logs in.
2. User arrives at Organization Selection.
3. User selects Join Organization.
4. User enters an organization code. The client trims it, uppercases it, and removes hyphens and
   whitespace before use.
5. The client reads `organization_join_codes/{code}` directly and checks `active == true`. There is
   no server step; the code is a bearer secret and reading it is what proves the user holds it.
6. System shows the organization name from the code's snapshot for confirmation.
7. User confirms Join.
8. One batched write creates the membership and its join proof. The membership has no teams and no
   permissions, so its effective role is Unassigned. Security Rules pin those values, so a joining
   user cannot grant themselves access on the way in.
9. User sees Unassigned Member State.
10. User cannot access normal organization modules yet.
11. Admin later assigns team(s) and permissions.
12. On the user's next organization entry, normal Dashboard access becomes available.

## 3. Returning User — Select an Organization

1. User logs in.
2. Organization Selection queries the user's own memberships with
   `where('uid','==',auth.uid).where('is_active','==',true)`, then reads each organization document
   by ID. The organizations collection is never listed. Both filters are required: Security Rules
   are not filters, and dropping one rejects the query rather than widening it.
3. Each card shows at least:
   - organization name,
   - role/status,
   - team summary when assigned.
4. User selects an organization.
5. If membership is `unassigned`, open Unassigned Member State.
6. Otherwise set `active_organization_id` and open Dashboard.

## 4. Switch Organizations

1. User is inside Organization A.
2. User opens organization switcher.
3. User selects Organization B.
4. App clears organization-scoped cached data/state.
5. `active_organization_id` becomes Organization B.
6. Permissions are recalculated using Organization B membership.
7. Dashboard reloads using only Organization B data.

At no point may Organization A records remain visible after the switch.

## 5. Admin — Process a Newly Joined Member

1. Admin opens Team & Member Management.
2. Admin sees Unassigned Members.
3. Admin selects a user.
4. Member Detail opens.
5. Admin assigns one or more teams.
6. Admin assigns module permission levels for inventory, maintenance, productions, and calendar.
7. Admin saves.
8. Because the saved membership has at least one team and at least one module at `view` or
   `edit`, the role changes from `unassigned` to `member` automatically. There is no manual status
   control.
9. User now receives access according to the new membership configuration.

If the Admin later removes every team or returns every module to `none`, the membership no longer
satisfies the assignment condition and returns to `unassigned`.

## 6. Admin — Create a Team

1. Admin opens Team & Member Management.
2. Admin selects Create Team.
3. Admin enters team name.
4. Optional description is entered.
5. Team is saved inside the active organization.
6. Team becomes available in:
   - member assignments,
   - inventory ownership,
   - production responsibility,
   - calendar visibility.

## 7. Inventory — Add an Item

1. Authorized user opens Inventory.
2. User selects Add Item.
3. User enters:
   - name,
   - category,
   - owning team,
   - total quantity,
   - available quantity,
   - condition counts,
   - location,
   - last inspected date,
   - notes.
4. Client validates fields.
5. Permission is checked.
6. Record is written with active `organization_id`.
7. User returns to Inventory List or Item Detail.

## 8. Inventory — Find Equipment with Standard Search

1. User opens Inventory List.
2. User types a keyword and/or selects filters.
3. Query is restricted to:
   - active organization,
   - permitted data scope.
4. Matching real inventory records are shown.

## 9. Inventory — AI Smart Search

1. User opens Inventory.
2. User selects AI Smart Search or focuses the AI search input.
3. User enters a natural-language question.
4. AI converts the request into supported structured filters, using team **names** rather than
   IDs and returning conditions as a list.
5. App validates AI output against the approved schema and resolves any team name to a real team
   ID within the active organization.
6. App displays the interpreted filters.
7. Firestore query runs using:
   - active organization,
   - user permissions,
   - validated structured filters.
8. Actual matching records are displayed.
9. If AI interpretation is ambiguous, ask the user to refine the query rather than inventing a result.

Example:

User input:

“Show available microphones that need repair.”

Possible AI interpretation:

- category contains microphone
- available_qty > 0
- condition includes needs_repair

## 10. Maintenance — Send Equipment for Repair

1. Authorized user opens Inventory Item Detail or Maintenance Overview.
2. User selects Add Repair Record.
3. User enters issue and service information.
4. User sets status such as `sent`.
5. Repair record is saved and linked to the inventory item.
6. Maintenance Overview now shows the item in service.
7. Expected return date is displayed.
8. If expected return date passes before returned status, UI marks the record overdue.

## 11. Maintenance — Receive Repaired Equipment

1. User opens the repair record.
2. User changes status to `returned`.
3. User enters actual returned date and final notes.
4. App prompts user to review:
   - item condition,
   - available quantity.
5. The user decides whether to change those values. The application never adjusts available
   quantity by itself; the quantity shown as currently in service is a separate derived figure.
6. Repair history remains visible permanently.

## 12. Production — Create a Production

1. Authorized user opens Production List.
2. User selects Create Production.
3. User enters title, date range, status, and description/notes.
4. Production is saved to the active organization.
5. Production Detail opens.

## 13. Production — Add a Requirement Manually

1. User opens Production Detail / Requirements.
2. User selects Add Requirement.
3. User enters a free-text need or links an existing inventory item.
4. User sets required quantity.
5. User assigns responsible team.
6. App obtains actual available quantity from the linked inventory item.
7. App calculates:

`shortage_qty = max(required_qty - available_qty, 0)`

8. Requirement is saved. Available quantity and shortage are not saved with it; they are
   recomputed whenever the requirement is displayed.
9. If the requirement has no linked inventory item, it is Not Matched: available quantity is null,
   no shortage is calculated, and no action type can be chosen yet.
10. If shortage is zero, show Already Available.
11. If shortage is greater than zero, user may select an action type.

## 14. Production — AI Requirement Generator

1. User opens a production.
2. User selects Generate Requirements with AI.
3. App supplies production context to the AI service.
4. AI returns structured suggestions containing a team **name** and an inventory match
   **keyword**, never document IDs.
5. App resolves those against real organization data and attempts safe inventory matching, leaving
   low-confidence matches unlinked for the user to decide.
6. Suggestions are displayed as a review list.
7. User may:
   - Accept
   - Edit
   - Remove
   - Regenerate
8. User selects Add Selected Requirements.
9. Only approved items are written to Firestore.
10. App retrieves actual inventory availability.
11. App calculates shortages deterministically.
12. Action planning continues from real data.

## 15. Needs & Actions — Resolve a Shortage

1. Production requirement is linked to an inventory item and has a shortage greater than zero.
2. User selects an action type:
   - Buy
   - Rent
   - Build
   - Repair
3. Action item is created or updated at `action_items/{requirement_id}`. Because the requirement
   ID is the document ID, one requirement can never accumulate more than one action item.
4. Quantity defaults to the current shortage and remains editable afterwards.
5. User may assign:
   - team,
   - assignee,
   - due date,
   - status,
   - notes.
6. Action appears in the Production Needs & Actions and global Needs & Actions. Access to both follows the
   productions permission.
7. When complete, user marks it Done.

No action item is created when the requirement is Not Matched, when the shortage is zero, or when
the requirement is Already Available. If a shortage later drops to zero, mark the existing action
item Done or Cancelled rather than deleting it.

## 16. Calendar — Create an Event

1. Authorized user opens Calendar.
2. User selects Create Event.
3. User enters title, date, and optionally a start and end time. Leaving the times empty makes it
   an all-day event.
4. User selects visibility:
   - All Teams
   - One or more specific teams
5. User may link a production or repair record.
6. User adds notes.
7. Event is saved.
8. Calendar shows the event to every user with calendar view permission in the organization.
   Team visibility drives filtering and labelling in the UI; it is not a read restriction.

## 17. Admin — Regenerate Organization Code

1. Admin opens Organization Settings. The join code is visible to the Admin only; members and
   unassigned users cannot read it anywhere in the application.
2. Admin selects Regenerate Code. Only an Admin may run this operation.
3. UI warns that the old code will stop working.
4. Admin confirms.
5. One batched write creates the new code document, sets the old one to `active: false` with a
   `revoked_at` timestamp, and repoints `organization_admin_settings.current_join_code_id`.
   Security Rules allow this only for the organization's Admin.
6. Old code documents are never deleted, so a revoked code fails validation for a clear reason
   rather than looking like a typo.
7. Existing memberships remain unchanged.
8. New join code is displayed to the Admin, who is the only role that can read which code is
   current.

## 18. Admin — Transfer Admin Role

1. Admin opens Organization Settings.
2. Admin selects Transfer Admin.
3. Admin selects an eligible existing member.
4. UI clearly explains the effect.
5. Admin confirms.
6. A client-side Firestore transaction reads the organization and the target membership, confirms
   the caller is the current Admin and the target membership is active, then writes `admin_uid`.
   No membership document is touched, because no membership carries a role.
7. Target user becomes Admin, keeping their existing teams and permissions untouched. Admin access
   takes precedence over those values while they hold administration.
8. The previous Admin's role resolves from the teams and permissions their membership already
   carries:
   - at least one team and at least one module at View or Edit → Member,
   - otherwise → Unassigned Member.
   Nothing is written to make this happen; the effective-role computation simply reads a different
   `admin_uid`.
9. No extra step asks the transferring Admin to configure their own future permissions. If they
   land in Unassigned, the new Admin assigns them through the normal Member Detail flow.
10. Organization never exists without an Admin. Security Rules reject a transfer to a uid without
    an active membership, and reject deactivating the current Admin's membership.

## 19. Permission-Denied Flow

If a user navigates directly to a route or attempts an operation without permission:

1. UI route guard blocks the action where possible.
2. Firestore Security Rules block unauthorized access. They are the only enforcement point; there
   is no server behind them.
3. App shows a clear permission-denied message.
4. Existing data remains unchanged.

## 20. AI Failure Flow

If an AI request fails, times out, or returns invalid structured output:

1. Do not write any data.
2. Show a concise error message.
3. Preserve user-entered production/search text.
4. Allow retry.
5. Offer manual search or manual requirement entry as fallback.
