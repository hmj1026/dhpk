scope: content-fingerprint
note: Build the Cursor virtual fingerprint tree once for all six prefixes, hash each file as it is read in path fingerprints, emit directory entry fingerprints in sorted-key order directly, and classify directories and links from Dirent so only files are lstat-ed, with no digest or error change (#1371).
