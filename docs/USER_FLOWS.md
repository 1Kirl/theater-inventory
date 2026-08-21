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
9. Organization is created.
10. Current user becomes the first Admin.
11. System generates an organization join code.
12. Organization Created screen shows the join code.
13. User selects Enter Organization.
14. Dashboard opens for the new organization.

## 2. First-Time User — Join an Existing Organization

1. User creates a personal account or logs in.
2. User arrives at Organization Selection.
3. User selects Join Organization.
4. User enters an organization code.
5. System validates the code.
6. System shows organization name for confirmation.
7. User confirms Join.
8. Membership is created with status `unassigned`.
9. User sees Unassigned Member State.
10. User cannot access normal organization modules yet.
11. Admin later assigns team(s) and permissions.
12. On the user's next organization entry, normal Dashboard access becomes available.

## 3. Returning User — Select an Organization

1. User logs in.
2. Organization Selection displays all memberships.
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
5. Admin changes membership status from `unassigned` to `member`.
6. Admin assigns one or more teams.
7. Admin assigns module permission levels.
8. Admin saves.
9. User now receives access according to the new membership configuration.

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
4. AI converts the request into supported structured filters.
5. App validates/sanitizes AI output.
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
5. Repair history remains visible permanently.

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
6. App obtains actual available quantity from linked inventory when applicable.
7. App calculates:

`shortage_qty = max(required_qty - available_qty, 0)`

8. Requirement is saved.
9. If shortage is zero, show Already Available.
10. If shortage is greater than zero, user may select an action type.

## 14. Production — AI Requirement Generator

1. User opens a production.
2. User selects Generate Requirements with AI.
3. App supplies production context to the AI service.
4. AI returns structured suggestions.
5. App attempts safe inventory matching using real organization inventory candidates.
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

## 15. Action List — Resolve a Shortage

1. Production requirement has a shortage.
2. User selects an action type:
   - Buy
   - Rent
   - Build
   - Repair
3. Action item is created or updated for the related requirement.
4. User may assign:
   - team,
   - assignee,
   - due date,
   - status,
   - notes.
5. Action appears in the Production Action List and global Action List.
6. When complete, user marks it Done.

## 16. Calendar — Create an Event

1. Authorized user opens Calendar.
2. User selects Create Event.
3. User enters title and date/time.
4. User selects visibility:
   - All Teams
   - Specific Team
5. User may link a production or repair record.
6. User adds notes.
7. Event is saved.
8. Calendar shows the event to users with appropriate access.

## 17. Admin — Regenerate Organization Code

1. Admin opens Organization Settings.
2. Admin selects Regenerate Code.
3. UI warns that the old code will stop working.
4. Admin confirms.
5. Trusted backend invalidates old code and creates a new code.
6. Existing memberships remain unchanged.
7. New join code is displayed to Admin.

## 18. Admin — Transfer Admin Role

1. Admin opens Organization Settings.
2. Admin selects Transfer Admin.
3. Admin selects an eligible existing member.
4. UI clearly explains the effect.
5. Admin confirms.
6. Trusted backend performs an atomic transfer.
7. Target user becomes Admin.
8. Previous Admin becomes Member unless the approved product model later supports multiple Admins.
9. Organization never exists without an Admin.

## 19. Permission-Denied Flow

If a user navigates directly to a route or attempts an operation without permission:

1. UI route guard blocks the action where possible.
2. Firestore Security Rules / Cloud Function authorization block unauthorized backend access.
3. App shows a clear permission-denied message.
4. Existing data remains unchanged.

## 20. AI Failure Flow

If an AI request fails, times out, or returns invalid structured output:

1. Do not write any data.
2. Show a concise error message.
3. Preserve user-entered production/search text.
4. Allow retry.
5. Offer manual search or manual requirement entry as fallback.
