# Projects Index

只在需要 project-specific 範例、shortcut、預填值或覆寫規則時讀取本檔。

本 skill 由 dhpk plugin 提供（read-only），因此專案特化內容不放在 skill 目錄內，而是由使用端
專案提供一份覆寫檔。沿用 dhpk 既有的 `@rules/<x>-project.md` 慣例（例如 `feature-dev` 用
`@rules/testing.md` + `@rules/testing-project.md`）。

## Load Order

1. 先讀 `projects-generic.md`（通用 pattern 與中性範例，隨 plugin 出貨）。
2. 若使用端專案提供了 `@rules/dev-workflow-project.md`（位於該專案的 `.claude/rules/`），再讀它套用
   專案預填值、shortcut 與覆寫規則。
3. 若專案沒有提供該檔，就停在 generic guidance，不要假設任何既有專案規則。

## Project Override File

- 路徑：使用端專案的 `.claude/rules/dev-workflow-project.md`（透過 `@rules/dev-workflow-project.md` 解析）。
- 內容：profile 預填值、work-item system、repo-specific example、以及 path→test 提示等。
- 只有這份覆寫檔可以放專案 shortcut 與 repo-specific example；plugin 內的通用 reference 不應內嵌這些內容。
