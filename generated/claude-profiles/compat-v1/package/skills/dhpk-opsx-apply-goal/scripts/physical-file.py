#!/usr/bin/env python3
"""Descriptor-relative private immutable file creation for the CLI context."""

import errno
import os
import stat
import sys


PARENT_FD = 3
PRIVATE_MODE = 0o600
EXIT_SECURITY = 65
EXIT_EXISTS = 73


def fail(message, code=EXIT_SECURITY):
    sys.stderr.write(f"{message}\n")
    raise SystemExit(code)


def identity(value):
    return (value.st_dev, value.st_ino)


def private_regular(value):
    return (stat.S_ISREG(value.st_mode)
            and not stat.S_ISLNK(value.st_mode)
            and (value.st_mode & 0o777) == PRIVATE_MODE)


def lstat_at(name):
    return os.stat(name, dir_fd=PARENT_FD, follow_symlinks=False)


def assert_parent():
    value = os.fstat(PARENT_FD)
    if not stat.S_ISDIR(value.st_mode):
        fail("physical parent descriptor is not a directory")


def assert_absent(name):
    try:
        lstat_at(name)
    except FileNotFoundError:
        return
    except OSError as error:
        fail(f"physical context target cannot be inspected: {error}")
    fail("EEXIST:context path already exists", EXIT_EXISTS)


def cleanup(name, expected):
    try:
        value = lstat_at(name)
        if identity(value) == expected and private_regular(value):
            os.unlink(name, dir_fd=PARENT_FD)
    except (FileNotFoundError, OSError):
        pass


def main():
    if len(sys.argv) != 3:
        fail("physical context helper arguments are invalid")
    file_name, temporary = sys.argv[1:]
    if (not file_name or file_name in (".", "..")
            or os.path.basename(file_name) != file_name or "\x00" in file_name):
        fail("physical context target must be a direct file name")
    if (not temporary or os.path.basename(temporary) != temporary or "\x00" in temporary):
        fail("physical temporary target must be a direct file name")

    assert_parent()
    assert_absent(file_name)
    descriptor = None
    temporary_identity = None
    linked = False
    try:
        no_follow = getattr(os, "O_NOFOLLOW", 0)
        if not no_follow:
            fail("physical writes require O_NOFOLLOW")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | no_follow
        try:
            descriptor = os.open(temporary, flags, PRIVATE_MODE, dir_fd=PARENT_FD)
        except FileExistsError:
            fail("physical temporary name collided", EXIT_SECURITY)
        temporary_stat = os.fstat(descriptor)
        if not private_regular(temporary_stat) or temporary_stat.st_size != 0:
            fail("physical temporary file is not a private regular file")
        temporary_identity = identity(temporary_stat)

        payload = sys.stdin.buffer.read()
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            if written <= 0:
                fail("physical file write made no progress")
            offset += written
        os.fsync(descriptor)
        written_stat = os.fstat(descriptor)
        if (not private_regular(written_stat)
                or identity(written_stat) != temporary_identity
                or written_stat.st_size != len(payload)):
            fail("physical temporary file changed while writing")
        os.close(descriptor)
        descriptor = None

        assert_absent(file_name)
        try:
            os.link(temporary, file_name, src_dir_fd=PARENT_FD, dst_dir_fd=PARENT_FD,
                    follow_symlinks=False)
        except FileExistsError:
            fail("EEXIST:context path already exists", EXIT_EXISTS)
        linked = True
        final_stat = lstat_at(file_name)
        if (not private_regular(final_stat)
                or identity(final_stat) != temporary_identity
                or final_stat.st_size != len(payload)):
            fail("created context is not a private regular non-symlink file")
        os.unlink(temporary, dir_fd=PARENT_FD)
        temporary_identity = None
    except SystemExit:
        raise
    except OSError as error:
        if error.errno == errno.EEXIST:
            fail("EEXIST:context path already exists", EXIT_EXISTS)
        fail(f"physical context write failed: {error}")
    finally:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        if temporary_identity is not None:
            cleanup(temporary, temporary_identity)
        if linked and temporary_identity is not None:
            cleanup(file_name, temporary_identity)


if __name__ == "__main__":
    main()
