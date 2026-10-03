---
name: planning-lessons
description: Load at the start of every brainstorming or planning session; rules distilled from earlier specs and plans that drifted or missed.
---
# Planning lessons

1. Map the code before proposing: send explorer agents over the touched area first; three explorers up front cost less than one wrong design.
2. Propose the user's existing mechanism first (the tree, store or queue already in place) before any replacement; replace only when the existing one provably cannot do the job.
3. Make triggers follow data events (a period closing, a file landing, a record changing) rather than timers.
7. Write every task and step as a `- [ ]` checkbox with its verification, per the `checkbox-progress` skill; a plan without boxes cannot be resumed.
4. Ask questions grouped together, each with a recommended default, and let the user answer by exception.
5. Put the agent workflow, the success rules and the milestones in the first draft of a spec; never add them afterwards.
6. Check standing user rules (merge approval, uncommitted docs, no destructive tasks) against every new process decision as soon as it appears.
