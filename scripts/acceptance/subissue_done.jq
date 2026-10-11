def sections:
  reduce split("\n")[] as $line ({current: null, found: {}};
    if $line | test("^## .+$") then .current = $line[3:] | .found[.current] = ""
    elif .current then .found[.current] += $line + "\n"
    else . end)
  | .found;
def fully_ticked: split("\n") | any(test("^- \\[x\\] ")) and all(test("^- \\[ \\] ") | not);
def closes($number): test("Closes #\($number)(?!\\d)");

.pulls as $pulls
| any(.subIssues[];
    .column == "Done"
    and (.body // "" | sections.Checklist // "" | fully_ticked)
    and (.number as $number | any($pulls[]; .body // "" | closes($number))))
