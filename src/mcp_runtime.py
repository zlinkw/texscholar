"""Publish the most recently active MCP process identity, without paper data."""
from pathlib import Path
import json
import os
import sys
from contextlib import contextmanager
from source_review import Review


def process_alive(pid):
    if sys.platform != 'win32':
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        if ctypes.get_last_error() == 87:  # Process no longer exists.
            return False
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        code = wintypes.DWORD()
        if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)):
            raise ctypes.WinError(ctypes.get_last_error())
        return code.value == 259  # STILL_ACTIVE; never send a signal on Windows.
    finally:
        kernel.CloseHandle(handle)


@contextmanager
def runtime_lock(storage):
    path = storage / 'mcp-runtime.lock'
    if path.is_symlink() or path.is_junction() or (path.exists() and not path.is_file()):
        raise ValueError('MCP runtime lock is not a regular file')
    with path.open('a+b') as stream:
        if not stream.seek(0, 2):
            stream.write(b'\0'); stream.flush()
        stream.seek(0)
        if sys.platform == 'win32':
            import ctypes
            import msvcrt
            from ctypes import wintypes
            class Overlapped(ctypes.Structure):
                _fields_ = [('internal', ctypes.c_size_t), ('internal_high', ctypes.c_size_t),
                            ('offset', wintypes.DWORD), ('offset_high', wintypes.DWORD), ('event', wintypes.HANDLE)]
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.LockFileEx.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(Overlapped)]
            kernel.UnlockFileEx.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(Overlapped)]
            handle, overlapped = msvcrt.get_osfhandle(stream.fileno()), Overlapped()
            if not kernel.LockFileEx(handle, 2, 0, 1, 0, ctypes.byref(overlapped)):
                raise ctypes.WinError(ctypes.get_last_error())
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            stream.seek(0)
            if sys.platform == 'win32':
                if not kernel.UnlockFileEx(handle, 0, 1, 0, ctypes.byref(overlapped)):
                    raise ctypes.WinError(ctypes.get_last_error())
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def report(registrations, version, server):
    path = Path(registrations).resolve(strict=True).parent / 'mcp-runtime.json'
    with runtime_lock(path.parent):
        if path.is_symlink() or path.is_junction() or (path.exists() and not path.is_file()):
            raise ValueError('MCP runtime status target is not a regular file')
        previous = path.read_bytes() if path.exists() else None
        old = json.loads(previous) if previous else {}
        instances = {}
        for item in old.get('instances', [old] if old else []):
            if not isinstance(item.get('pid'), int) or item['pid'] <= 0 or not isinstance(item.get('version'), str) or not isinstance(item.get('server'), str):
                raise ValueError('Invalid MCP process report')
            if process_alive(item['pid']):
                instances[item['pid']] = item
        value = {'version': version, 'pid': os.getpid(), 'server': str(Path(server).resolve(strict=True))}
        instances[value['pid']] = value.copy()
        value.update(schema=2, instances=[instances[pid] for pid in sorted(instances)])
        raw = json.dumps(value, ensure_ascii=False).encode('utf-8')
        if previous != raw:
            Review.write(path, raw)
