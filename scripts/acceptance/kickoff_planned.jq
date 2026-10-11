def sections:
  reduce split("\n")[] as $line ({current: null, found: {}};
    if $line | test("^## .+$") then .current = $line[3:] | .found[.current] = ""
    elif .current then .found[.current] += $line + "\n"
    else . end)
  | .found | map_values(gsub("\\A\\s+|\\s+\\z"; ""));
def lines: split("\n") | map(select(test("\\S")));
def plan_names_files: lines | any(test("^Files: .*`[^`]+`"));
def checklist_is_commands: lines | length > 0 and all(test("^- \\[( |x)\\] .+: `[^`]+`$"));
def depends_on_is_valid: test("\\A(none|#\\d+(, #\\d+)*)\\z");
def contract_holds:
  sections
  | (.Goal // "" | length > 0)
    and (.Plan // "" | plan_names_files)
    and (.Checklist // "" | checklist_is_commands)
    and (."Depends on" // "" | depends_on_is_valid);
def moved_past_kickoff: .column | IN("Planned", "In Progress", "QA", "Done");

[.subIssues[] | select(.state | ascii_downcase == "open")]
| length > 0 and all(moved_past_kickoff and (.body // "" | contract_holds))
