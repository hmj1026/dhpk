scope: dep-audit
note: Report zero findings instead of blank severity counts when the package-manager audit produces no output (timeout, offline, or no lockfile), since jq prints nothing for an empty audit file.
