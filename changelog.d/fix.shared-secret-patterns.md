scope: packaging
note: The shared secret list now also blocks AWS access keys, Slack tokens, and private key headers, and the Cursor and Agent MCP scans extend that shared base instead of keeping separate copies, so they now also catch `github_pat_` tokens and MariaDB connection credentials (#1252).
