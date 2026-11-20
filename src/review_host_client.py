"""Connect a review transaction to the registered local editor host."""
import base64
import getpass
import json
import os
import socket
import tempfile
from urllib.parse import quote


class HostError(RuntimeError):
    pass


def endpoint():
    if os.name == 'nt':
        return r'\\.\pipe\texscholar-review-' + quote(getpass.getuser(), safe="-_.!~*'()")
    return os.path.join(tempfile.gettempdir(), f'texscholar-review-{os.getuid()}.sock')


class HostSession:
    """Reserve the registered host before persisting a source transaction intent."""
    def __init__(self, root, pipe=None):
        self.root, self.target = str(root), pipe or endpoint()
        self.connection = self.stream = None
        self.serial = 0

    def __enter__(self):
        try:
            if os.name == 'nt':
                self.stream = open(self.target, 'r+b', buffering=0)
            else:
                self.connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                self.connection.connect(self.target)
                self.stream = self.connection.makefile('rwb', buffering=0)
            self.exchange('reserve-review-transaction', root=self.root)
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_):
        if self.stream is not None:
            self.stream.close()
        if self.connection is not None:
            self.connection.close()

    def exchange(self, kind, **arguments):
        self.serial += 1
        message = {'id': self.serial, 'type': kind, **arguments}
        try:
            self.stream.write(json.dumps(message, ensure_ascii=False, separators=(',', ':')).encode('utf-8') + b'\n')
            response = self.stream.readline()
        except OSError as error:
            raise HostError('审核宿主连接失败；请核对事务状态。') from error
        if not response:
            raise HostError('宿主连接已断开；请核对事务状态。')
        result = json.loads(response.decode('utf-8'))
        if result.get('id') != message['id'] or result.get('ok') is not True:
            raise HostError(result.get('error') or '宿主事务回执无效。')
        return result

    def apply(self, state_sha, commit, final_raw, recover=False):
        common = {'root': self.root, 'state_sha': state_sha, 'commit': commit}
        self.exchange('apply-review-transaction', recover=recover, **common)
        return self.exchange('finalize-review-transaction', final=base64.b64encode(final_raw).decode('ascii'), **common)['result']

    def check(self):
        self.exchange('check-review-reservation', root=self.root)

    def apply_legacy(self, commit):
        return self.exchange('apply-legacy-review', root=self.root, commit=commit)['result']

    def apply_roles(self, plan):
        return self.exchange('apply-role-metadata', root=self.root, role_plan=plan)['result']

    def apply_migration(self, commit, recover=False):
        return self.exchange('apply-review-migration', root=self.root, commit=commit, recover=recover)['result']


def apply_review_transaction(root, state_sha, commit, final_raw, pipe=None, recover=False):
    """Apply and finalize one persisted intent through the same host connection."""
    try:
        with HostSession(root, pipe) as session:
            return session.apply(state_sha, commit, final_raw, recover)
    except OSError as error:
        raise HostError('无法连接审核宿主；请核对事务状态。') from error
