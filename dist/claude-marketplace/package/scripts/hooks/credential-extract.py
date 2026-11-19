#!/usr/bin/env python3
"""Extract selected public fields from a single strictly bounded MySQL PDO DSN."""

import json
import os
import re
import stat
import sys


def extract_file(path):
    # Open each path component without following links; reject non-regular files.
    if not os.path.isabs(path) or '\x00' in path:
        raise ValueError()
    components = path.split('/')[1:]
    if not components or any(part in ('', '.', '..') for part in components):
        raise ValueError()
    directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in components[:-1]:
            next_directory = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = next_directory
        descriptor = os.open(components[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise ValueError()
            data = b''
            while len(data) <= 1024:
                chunk = os.read(descriptor, 1025 - len(data))
                if not chunk:
                    break
                data += chunk
            if len(data) > 1024:
                raise ValueError()
        finally:
            os.close(descriptor)
    finally:
        os.close(directory)
    return data


def parse_dsn(data):
    if data.endswith(b'\n'):
        data = data[:-1]
    if not data.startswith(b'mysql:'):
        raise ValueError()
    parts = data[6:].split(b';')
    values = {}
    patterns = {
        b'host': rb'[A-Za-z0-9][A-Za-z0-9._-]{0,252}',
        b'dbname': rb'[A-Za-z0-9_]{1,64}',
        b'port': rb'[1-9][0-9]{0,4}',
        b'charset': rb'[A-Za-z0-9_]{1,32}',
    }
    for part in parts:
        name, separator, value = part.partition(b'=')
        if not separator or name not in patterns or name in values or not re.fullmatch(patterns[name], value):
            raise ValueError()
        if name == b'port' and int(value) > 65535:
            raise ValueError()
        values[name] = value.decode('ascii')
    if b'host' not in values or b'dbname' not in values:
        raise ValueError()
    return values


def main():
    if (len(sys.argv) != 5 or sys.argv[1] != '--file' or sys.argv[3] != '--fields'
            or sys.argv[4] not in ('host', 'dbname', 'host,dbname')):
        raise ValueError()
    values = parse_dsn(extract_file(sys.argv[2]))
    fields = sys.argv[4].split(',')
    sys.stdout.write(json.dumps({field: values[field.encode('ascii')] for field in fields}, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, UnicodeError):
        sys.stderr.write('Credential extraction rejected.\n')
        sys.exit(2)
