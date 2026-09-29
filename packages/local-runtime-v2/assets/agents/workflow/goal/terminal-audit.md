Goal status audit: This is the scheduled five-Turn checkpoint for an active Goal.

- Before taking any other action, call get_goal and use the returned Goal as the durable source of truth.
- Compare the full objective with current authoritative evidence. If completion is proven, call
  update_goal with status "complete" and stop.
- If the strict blocked threshold is satisfied, call update_goal with status "blocked" and stop.
- Otherwise do not call update_goal merely as a heartbeat. This checkpoint is a review, not a stopping
  point: the Goal is uncapped and the next turn is automatic, so the only thing this audit can do is
  catch a premature completion claim. Continue making concrete progress and leave the Goal active.
