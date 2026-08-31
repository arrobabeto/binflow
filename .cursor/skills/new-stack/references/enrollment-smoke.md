# Enrollment smoke (acceptance for later impl)

Implementation is complete only when these pass (operator path:
[`docs/ENROLLMENT.md`](../../../../docs/ENROLLMENT.md) section B).

## Must pass

1. New profile appears in dashboard **New client** select.
2. Enrollment can be created with that profile.
3. Every profile-required credential verifies (including new kinds).
4. Validate reaches `ready_for_pairing`.
5. Pairing link on the **client** bot activates enrollment to `active`.
6. Client bot replies after pairing (`/help` or pairing confirmation).
7. Empty catalog allowed ⇒ `active` with zero bindings; otherwise required
   tools present.
8. Incompatible tools from other profiles are not assignable.
9. Live stacks (e.g. `astro_repo`) still enroll and run prior smoke unchanged.

## Ops reminders

- One Telegram polling worker only.
- New client bot: wait ≤ one worker heartbeat after verify (hot-load).
- Restart worker only if worker code changed.
