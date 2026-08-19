# Behavior-Preserving Refactor Notes

## Current Responsibility Map

- `lib/llm.ts` still owns the existing AI behavior: slot classification, next-question generation, topic switch decisions, end checks, final minutes, and semantic debug state.
- `lib/acp-mvp.ts` owns ACP domain definitions, slot/sub-slot definitions, transcript rendering, slot-control debug state, and minutes rendering/validation helpers.
- `lib/acp-store.ts` owns conversion between Prisma records and ACP domain objects.
- `app/api/ai/*/route.ts` parses requests, loads session context, calls AI application functions, persists results where needed, and formats responses.

## Refactor Boundary Added

The first safe boundary is `lib/ai/*`.

- `lib/ai/slot-state.ts`
- `lib/ai/next-question.ts`
- `lib/ai/topic-switch.ts`
- `lib/ai/conversation-end.ts`
- `lib/ai/final-minutes.ts`
- `lib/ai/debug.ts`
- `lib/ai/client.ts`

The behavior-owning functions are re-exported from `lib/llm.ts` rather than rewritten. This keeps prompts, schemas, model settings, message order, fallback logic, and slot-state merge logic unchanged.

## Intentionally Not Changed

- Slot definitions and sub-slot definitions.
- Prompt text, prompt order, and response schema.
- Slot completion, response state, reason code, evidence, `canAskAgain`, and `isDeferred` logic.
- Question selection, question wording, topic transition, end-check, and minutes logic.
- Database schema and persisted field names.
- Remote microphone behavior.
- UI behavior.

## Lowest-Risk Next Step

Move one behavior function at a time from `lib/llm.ts` into the matching `lib/ai/*` file only after characterization coverage exists for its inputs and outputs.

## Research ID Readability

Internal `cuid()` primary keys are still preserved for application joins. For research work, query the `research_*` database views so each row includes `participant_code` next to the internal `session_id`.

- `research_sessions`
- `research_utterances`
- `research_ai_intervention_logs`
- `research_final_minutes`
- `research_slot_states`
- `research_slot_sub_states`
- `research_remote_mic_join_tokens`
- `research_remote_mic_audio_chunks`

Tables that belong to a session now also carry a nullable `participant_code` column next to `session_id` in the Prisma schema. Database triggers populate it from `sessions.participant_code` on insert and keep it synchronized if the session's participant code is edited.
