# route-table-precision Specification

## Purpose
Keep command routing specific to imperative requests and protect it with
regression cases for incidental command-name mentions.
## Requirements
### Requirement: Route patterns do not match incidental skill-name mentions
The create-pr route pattern in `scripts/lib/route-table.json` SHALL NOT match a query that merely mentions the literal token `create-pr` (or an equivalent hyphenated command name) inside a longer enumeration, while continuing to match genuine imperative requests to create/open/draft a PR.

#### Scenario: Issue-list mention does not route
- **WHEN** the pre-route matcher receives a multi-issue report whose text contains `create-pr 前置檢查 git rev-list` as one item
- **THEN** the matcher does not return `MATCH dhpk:create-pr` for that query

#### Scenario: Genuine request still routes
- **WHEN** the matcher receives `幫我 create a PR for this branch` or `open a pull request`
- **THEN** it returns `MATCH dhpk:create-pr`

### Requirement: Route-pattern regressions are covered by a test corpus
The route-table test suite SHALL include table-driven positive and negative cases for the create-pr pattern, including the incidental-mention negative case.

#### Scenario: Corpus guards the pattern
- **WHEN** `node tests/run-all.js` runs
- **THEN** the route-table test asserts both the positive imperative matches and the incidental-mention non-match
