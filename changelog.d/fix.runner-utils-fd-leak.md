scope: runner-utils
note: Fix fd leak in runner-utils tailLinesFromFile when Buffer.alloc or readSync throws after openSync by closing the fd in a finally block (#1365).
