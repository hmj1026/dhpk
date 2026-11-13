scope: release
note: Fix extract-notes.sh to match the release version literally instead of splicing it into a regex and awk program, so versions containing "." or "+" no longer match lookalike headings or fail (#1366).
