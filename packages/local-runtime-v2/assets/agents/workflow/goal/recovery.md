Goal recovery check: This Goal is resuming after a retracted Turn or Runtime recovery. The conversation
excerpt may be incomplete or stale, and the worktree is the only thing you can trust.

- Before taking any other action, call get_goal and use its returned goal id, objective, and status as the
  durable source of truth.
- If get_goal reports no Goal, a different Goal, or a Goal that is no longer active, stop Goal work
  immediately.
- If the returned Goal is active, resume its full objective from current authoritative evidence.
  Recovering is not restarting: keep whatever durable notes and plan you already wrote, re-verify them
  against the worktree, and continue from the last real state instead of re-deriving work that is
  already done.
- Call update_goal only when the objective is proven complete, the strict blocked threshold is satisfied,
  or a valid token-budget change is required. Otherwise keep making concrete progress and leave the Goal
  active. A recovery is not a reason to stop early.
