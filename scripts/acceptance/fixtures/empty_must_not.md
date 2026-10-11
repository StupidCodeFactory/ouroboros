## Goal
Owners see their Page in the list.

## Plan
1. Red: request spec.
2. Green: controller.
Files: `app/controllers/pages_controller.rb`, `spec/requests/**`

## Checklist
- [ ] the list shows the Page: `bin/rspec spec/requests/pages_spec.rb:4`
- [ ] an empty list says so: `bin/rspec spec/requests/pages_spec.rb:12`

## Completion condition
- `bin/rspec`
- `bin/rubocop`

## Stop conditions
- Meta returns a shape the spec does not name: stop and ask.

## Must not


## Depends on
none
