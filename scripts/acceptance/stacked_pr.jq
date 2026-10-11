def closes_any($numbers): . as $body | any($numbers[]; . as $number | $body | test("Closes #\($number)(?!\\d)"));
def created_while_open($first): .createdAt as $created | [$first.mergedAt, $first.closedAt | values] | all(.[]; $created < .);

[.subIssues[].number] as $numbers
| .pulls as $pulls
| any($pulls[] | select(.body // "" | closes_any($numbers));
    . as $first
    | any($pulls[]; .baseRefName == $first.headRefName and created_while_open($first)))
