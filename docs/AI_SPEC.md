# Theater Inventory Tracker — AI Feature Specification

## 1. AI Philosophy

AI should solve a real workflow problem inside the theater application.

AI is not a general-purpose chatbot.

The MVP contains exactly two required AI features:

1. AI Smart Search
2. AI Requirement Generator

AI assists the user, but deterministic application code remains responsible for permissions, database truth, calculations, and final writes.

## 2. Provider

Preferred implementation:

- Firebase AI Logic
- Gemini model supported by Firebase AI Logic

Wrap provider-specific code behind an internal `aiService` interface so the UI does not depend directly on a specific model SDK.

Do not expose private server API keys in client code.

## 3. AI Smart Search

### 3.1 Goal

Allow a technician to search inventory using natural language instead of manually configuring every filter.

Examples:

- “Show available microphones.”
- “Which lighting equipment needs repair?”
- “Find cables in Lighting Storage A.”
- “Show unusable sound equipment.”

### 3.2 AI Responsibility

The model converts natural language into a structured search intent.

The model does **not** return final inventory records.

### 3.3 Allowed Output Schema

```ts
interface InventorySearchFilters {
  search_text?: string;
  category?: string;
  team_name?: string;
  location?: string;
  conditions?: Array<
    'excellent' | 'good' | 'fair' | 'needs_repair' | 'unusable'
  >;
  availability?: 'available' | 'unavailable' | 'any';
}
```

If team name must be converted to a team ID, do that through application data after AI parsing.

### 3.4 Example

User:

“Show available microphones that need repair.”

AI output:

```json
{
  "search_text": "microphone",
  "conditions": ["needs_repair"],
  "availability": "available"
}
```

Application then:

1. validates the object,
2. applies active organization scope,
3. applies user read permissions,
4. queries real Firestore inventory,
5. displays actual records.

### 3.5 Safety / Reliability Rules

- Never fabricate inventory records.
- Never claim that an item exists unless Firestore returned it.
- Never return an `organization_id` from the model.
- Never accept an arbitrary Firestore field name from the model.
- Only allow fields defined in the approved schema.
- Invalid output must be rejected.
- If query meaning is ambiguous, ask the user to rephrase or show the interpreted filters clearly.
- Standard manual search must remain available if AI fails.

### 3.6 UX

Display:

- user query,
- interpreted filters,
- matching real records,
- clear/reset action.

Suggested examples may appear as prompt chips.

## 4. AI Requirement Generator

### 4.1 Goal

Help users create a first draft of equipment/material needs for a production.

This is especially useful when a student technician knows the production concept but has not yet written a complete technical requirement list.

### 4.2 Inputs

Allowed context may include:

- production title,
- production description,
- production notes,
- production dates when relevant,
- existing production requirements,
- a limited organization inventory summary or inventory matching candidates.

Do not send unrelated organization/member/private data.

### 4.3 AI Output Schema

```ts
interface AIRequirementSuggestion {
  client_temp_id: string;
  item_name: string;
  suggested_qty: number;
  category?: string;
  suggested_team_name?: string;
  inventory_match_keyword?: string;
  rationale?: string;
}
```

The model may suggest a possible inventory match keyword, but the application must resolve actual inventory IDs using real data.

### 4.4 Example Input

Production description:

“A school musical with 20 performers, live vocals, stage lighting, and several set changes.”

### 4.5 Example AI Suggestions

```json
[
  {
    "client_temp_id": "tmp-1",
    "item_name": "Wireless Microphones",
    "suggested_qty": 12,
    "category": "Sound Equipment",
    "suggested_team_name": "Sound",
    "rationale": "Multiple performers require individual or shared vocal reinforcement."
  },
  {
    "client_temp_id": "tmp-2",
    "item_name": "Source Four Lights",
    "suggested_qty": 16,
    "category": "Lighting Instruments",
    "suggested_team_name": "Lighting",
    "rationale": "A musical normally requires flexible front, area, and special lighting coverage."
  }
]
```

### 4.6 Required Review Step

AI suggestions are temporary UI data.

For each suggestion, the user can:

- Accept
- Edit
- Remove

The user then selects:

`Add Selected Requirements`

Only then are approved records written to Firestore.

### 4.7 Inventory Matching

After AI suggestions are returned:

1. Normalize the suggested item name/category.
2. Search real inventory candidates in the active organization.
3. Show the suggested match to the user.
4. Let the user correct the match.
5. Do not silently link a low-confidence match.

### 4.8 Quantity and Shortage Rules

The AI may suggest a required quantity.

The app may allow the user to edit it before saving.

The AI must **not** be trusted for available quantity or shortage math.

After approval:

```ts
const shortageQty = Math.max(requiredQty - availableQty, 0);
```

Use actual inventory availability.

### 4.9 Safety / Reliability Rules

- Do not write AI suggestions directly to Firestore.
- Do not delete existing requirements because the AI produced a different list.
- Do not invent inventory availability.
- Do not create action items automatically before the approved requirement exists.
- If model output is malformed, preserve the user's production description and allow retry.
- Manual requirement entry must always remain available.

## 5. Prompting Rules

System prompts should tell the model:

- this is a high school theater inventory application,
- return only the requested structured schema,
- do not invent organization inventory,
- distinguish suggestions from facts,
- keep suggestions practical for a school theater context,
- avoid enterprise-scale assumptions,
- avoid suggesting unsafe technical practices.

## 6. Validation

Use runtime schema validation before consuming model output.

Recommended approach:

- Zod or equivalent small schema validator if already approved as a dependency.

If adding Zod only for AI structured validation, explain the dependency before installation.

Validation failures should result in a safe retry/error state.

## 7. Permissions and Organization Scope

AI requests must always operate inside the current organization context.

AI Smart Search:

- may only search data the user may read.

AI Requirement Generator:

- may be viewed with Productions View permission,
- saving approved suggestions requires Productions Edit permission.

AI features must never be used to bypass Firestore Security Rules.

## 8. AI Logging

For MVP, detailed prompt logging is optional.

Do not store sensitive or unnecessary user text by default.

If logging is added for debugging:

- store minimal metadata,
- avoid passwords/tokens,
- avoid storing full prompts unless necessary,
- remove debug logging before final demo if it exposes data.

## 9. AI Test Cases

### Smart Search

Test at minimum:

1. “Show available microphones.”
2. “Which lighting equipment needs repair?”
3. “Show costumes.”
4. Ambiguous query: “Show the bad stuff.”
5. Query with no results.
6. User with no Inventory View permission.
7. Organization switch followed by a query.

### Requirement Generator

Test at minimum:

1. Simple play.
2. Musical with microphones and lighting.
3. Production with existing requirements.
4. Empty/very short description.
5. AI returns an item not found in inventory.
6. User edits AI quantity before approval.
7. User removes a suggestion.
8. AI call fails.
9. User has View but not Edit permission.
