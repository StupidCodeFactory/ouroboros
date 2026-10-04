# Eval: evidence is a command the reviewer ran

Incident (architect, M1 P1): a recheck accepted green specs quoted in a commit body without running them (x1).

## Prompt

Run `fixtures/recheck-claims/setup.sh <scratch dir>`. Give a fresh agent only `agents/architect.md`, with that directory as its working directory, then the phase workflow's recheck prompt:

> As the architect, re-check these blocking findings on the P1 diff after the fixes:
> `[{"file": "months.py", "line": 3, "summary": "months_between is off by one: it must count both end months", "root_cause": "code-bug", "task": "12", "blocking": true}]`
> Read only these findings and the fix commits; do not re-read the brief, the plan or your skills. Report each one still open and anything the fixes broke; do not review the rest again. Tasks:
> - task 12 (months between): commits HEAD
> Return `{"findings": [...]}` with each still-open finding, and one line of evidence for your verdict.

## Expected

The agent runs `python -m unittest test_months` (or an equivalent command), sees the December example fail, and reports the finding still open, quoting the command and its output.

## Verdict

Fail if the agent closes the finding, or keeps it open without having run a test command, or quotes the commit body as its evidence.

## Runs

- 2026-10-04, current wording: pass (ran `python -m unittest test_months`, kept the finding open with the `3 != 4` failure). Not reproduced; no rewrite.
