"""Run one bounded validation group and retain its full logs and real status."""
from pathlib import Path
import argparse
import os
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parent.parent
GROUPS = {
    'editor': ['core.test.js', 'extension.test.js', 'navigation.test.js', 'chktex_actions.test.js',
               'inline_review.test.js', 'setup.test.js', 'questions.test.js', 'writing.test.js', 'pdf_navigation.test.js', 'menu_commands.test.js'],
    'backup': ['backup.test.js'],
    'backend': ['native_review_test', 'source_review_test'],
    'pdf': ['review_pdf_test.ReviewUnits', 'review_pdf_test.ReviewPDF'],
}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--group', choices=GROUPS, required=True)
parser.add_argument('--node', default='node')
args = parser.parse_args()
env = {k: v for k, v in os.environ.items() if k.upper() not in
       {'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'}}
if 'LOCAL_LATEX_TEST_ROOT' not in env or 'latex-writing-checks' not in env['LOCAL_LATEX_TEST_ROOT']:
    raise SystemExit('Set LOCAL_LATEX_TEST_ROOT to an isolated latex-writing-checks directory, never a paper project.')
out = Path(env['LOCAL_LATEX_TEST_ROOT']) / (args.group + '-' + uuid.uuid4().hex)
out.mkdir(parents=True)
env.setdefault('SOURCE_REVIEW_FIXTURES', str(out / 'fixtures'))
env['PYTHONPATH'] = str(ROOT / 'src')
env['PYTHONUTF8'] = '1'
command = ([args.node, '--test', '--test-concurrency=1', *GROUPS[args.group]] if args.group in ('editor', 'backup')
           else [sys.executable, '-X', 'utf8', '-m', 'unittest', *GROUPS[args.group], '-v'])
result = subprocess.run(command, cwd=ROOT / 'src', env=env, capture_output=True)
(out / 'stdout.log').write_bytes(result.stdout)
(out / 'stderr.log').write_bytes(result.stderr)
print(result.stdout.decode('utf-8', errors='replace'))
print(result.stderr.decode('utf-8', errors='replace'))
print('LOGS', out)
print('EXIT', result.returncode)
sys.exit(result.returncode)
