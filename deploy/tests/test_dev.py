"""Ручной dev-deploy: настоящий Git и PEM, без подключения к серверу/Docker."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "dev.sh"
BASH = "C:/Program Files/Git/bin/bash.exe" if os.name == "nt" else "bash"


class DevDeployTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cert_tmp = tempfile.TemporaryDirectory(prefix="mvs-dev-cert-")
        cls.cert = Path(cls.cert_tmp.name)
        command = ['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                   '-keyout', 'key.pem', '-out', 'cert.pem', '-days', '1',
                   '-subj', '/CN=*.example.org', '-addext', 'subjectAltName=DNS:*.example.org']
        result = subprocess.run([BASH, '-c', ' '.join(command)], cwd=cls.cert,
                                capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr)
        result = subprocess.run([BASH, '-c', 'openssl genpkey -algorithm ED25519 -out wrong-key.pem'],
                                cwd=cls.cert, capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.cert_tmp.cleanup()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="mvs-dev-test-")
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.remote = self.base / "remote.git"
        self.author = self.base / "author"
        self.app = self.base / "app"
        self.bin = self.base / "bin"
        self.bin.mkdir()
        self.git(self.base, 'init', '--bare', str(self.remote))
        self.git(self.base, 'clone', str(self.remote), str(self.author))
        self.git(self.author, 'checkout', '-b', 'dev')
        (self.author / 'deploy').mkdir()
        (self.author / '.gitignore').write_text('.env\ndeploy/certs/*.pem\n', encoding='utf-8')
        (self.author / 'docker-compose.yml').write_text('services: {}\n', encoding='utf-8')
        if SOURCE.exists():
            shutil.copyfile(SOURCE, self.author / 'deploy/dev.sh')
        # Эти внешние операции заменены; управление Git, проверки и порядок — настоящий dev.sh.
        (self.author / 'deploy/video-secrets.sh').write_text('exit 0\n', encoding='utf-8')
        (self.author / 'deploy/backup.sh').write_text(
            'set -eu\n[[ ${FAIL_BACKUP:-0} != 1 ]] || exit 42\n'
            'mkdir -p "$BACKUP_DIR"\nprintf backup > "$BACKUP_DIR/db-fixture.sql"\n', encoding='utf-8')
        self.commit(self.author, 'initial')
        self.git(self.author, 'push', '-u', 'origin', 'dev')
        self.git(self.base, 'clone', '--branch', 'dev', str(self.remote), str(self.app))
        self.initial = self.git(self.app, 'rev-parse', 'HEAD').strip()
        (self.app / '.env').write_text(
            'COMPOSE_PROJECT_NAME=mvsst-dev\nDOMAIN=dev.example.org\nTLS_MODE=files\n', encoding='utf-8')
        cert_dir = self.app / 'deploy/certs'
        cert_dir.mkdir()
        for name in ('cert.pem', 'key.pem'):
            shutil.copyfile(self.cert / name, cert_dir / name)
        self.write_tool('docker', '''#!/usr/bin/env bash
set -eu
echo "$*" >> "$DOCKER_LOG"
if [[ "$*" == "compose ps -a -q" && ${HAS_CONTAINERS:-0} == 1 ]]; then echo container-id; fi
if [[ "$*" == "compose build web" && ${FAIL_BUILD:-0} == 1 ]]; then exit 43; fi
''')
        self.write_tool('curl', '#!/usr/bin/env bash\nexit "${FAIL_HEALTH:-0}"\n')
        # Git for Windows не содержит flock. Только этот системный примитив заменяется на Windows.
        # На Linux используются настоящие flock и дескриптор, открытый скриптом.
        if os.name == 'nt':
            self.write_tool('flock', '#!/usr/bin/env bash\nexit 0\n')
        self.log = self.base / 'docker.log'

    def write_tool(self, name, content):
        path = self.bin / name
        path.write_text(content, encoding='utf-8', newline='\n')
        path.chmod(0o755)

    def git(self, cwd, *args):
        result = subprocess.run(['git', '-c', 'user.name=Dev deploy test',
                                 '-c', 'user.email=dev-test@example.invalid', *args],
                                cwd=cwd, capture_output=True, text=True, encoding='utf-8')
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout

    def commit(self, cwd, message):
        self.git(cwd, 'add', '.')
        self.git(cwd, 'commit', '-m', message)

    def publish_next(self):
        (self.author / 'revision.txt').write_text('new dev version\n', encoding='utf-8')
        self.commit(self.author, 'next')
        self.git(self.author, 'push', 'origin', 'dev')
        return self.git(self.author, 'rev-parse', 'HEAD').strip()

    def run_deploy(self, command, **extra):
        env = {**os.environ, 'BACKUP_DIR': self.base.joinpath('backups').as_posix(),
               'DOCKER_LOG': self.log.as_posix(), 'LC_ALL': 'C.UTF-8', **extra}
        env['TEST_BIN'] = self.bin.as_posix()
        prefix = '$(cygpath -u "$TEST_BIN")' if os.name == 'nt' else '$TEST_BIN'
        return subprocess.run([BASH, '-c', f'export PATH="{prefix}:$PATH"; bash deploy/dev.sh "$1"',
                               'test', command], cwd=self.app, env=env, capture_output=True,
                              text=True, encoding='utf-8')

    def marker(self):
        return self.app / '.git/mvsst-dev.deployed'

    def test_start_deploys_latest_dev_and_records_only_success(self):
        target = self.publish_next()
        result = self.run_deploy('start')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git(self.app, 'rev-parse', 'HEAD').strip(), target)
        self.assertEqual(self.marker().read_text().strip(), target)

    def test_dirty_checkout_is_preserved(self):
        dirty = self.app / 'docker-compose.yml'
        dirty.write_text('unsaved admin edit\n', encoding='utf-8')
        result = self.run_deploy('update')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('локальные изменения', result.stderr)
        self.assertEqual(dirty.read_text(), 'unsaved admin edit\n')
        self.assertFalse(self.marker().exists())

    def test_other_branch_is_refused(self):
        self.git(self.app, 'checkout', '-b', 'main')
        result = self.run_deploy('start')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ветке dev', result.stderr)

    def test_local_unpublished_commit_is_not_deployed(self):
        (self.app / 'local.txt').write_text('local change\n', encoding='utf-8')
        self.commit(self.app, 'local unpublished')
        result = self.run_deploy('update')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('origin/dev', result.stderr)
        self.assertFalse(self.marker().exists())

    def test_production_project_is_refused(self):
        (self.app / '.env').write_text('COMPOSE_PROJECT_NAME=production\n', encoding='utf-8')
        result = self.run_deploy('start')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('COMPOSE_PROJECT_NAME=mvsst-dev', result.stderr)
        self.assertFalse(self.log.exists())

    def test_wildcard_wrong_level_is_refused(self):
        text = (self.app / '.env').read_text().replace('dev.example.org', 'site.dev.example.org')
        (self.app / '.env').write_text(text, encoding='utf-8')
        result = self.run_deploy('start')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('сертификат', result.stderr.lower())
        self.assertFalse(self.marker().exists())

    def test_mismatched_private_key_is_refused_before_build(self):
        shutil.copyfile(self.cert / 'wrong-key.pem', self.app / 'deploy/certs/key.pem')
        result = self.run_deploy('start')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('не соответствуют', result.stderr)
        self.assertFalse(self.log.exists())

    def test_untracked_files_are_preserved_and_not_deployed(self):
        local = self.app / 'local-notes.txt'
        local.write_text('do not delete\n', encoding='utf-8')
        result = self.run_deploy('update')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('неотслеживаемые', result.stderr)
        self.assertEqual(local.read_text(), 'do not delete\n')
        self.assertFalse(self.marker().exists())

    def test_backup_failure_does_not_advance_checkout(self):
        self.publish_next()
        result = self.run_deploy('update', FAIL_BACKUP='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git(self.app, 'rev-parse', 'HEAD').strip(), self.initial)
        self.assertFalse(self.marker().exists())

    def test_update_backs_up_previous_revision_and_preserves_env(self):
        target = self.publish_next()
        before = (self.app / '.env').read_bytes()
        result = self.run_deploy('update')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.app / '.env').read_bytes(), before)
        self.assertEqual(self.marker().read_text().strip(), target)
        backups = list((self.base / 'backups').glob('*/code-sha.txt'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text().strip(), self.initial)
        self.assertTrue((backups[0].parent / 'db-fixture.sql').exists())

    def test_failed_build_does_not_record_new_revision_or_restart(self):
        self.marker().write_text(self.initial + '\n', encoding='utf-8')
        self.publish_next()
        result = self.run_deploy('update', FAIL_BUILD='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.marker().read_text().strip(), self.initial)
        self.assertNotIn('compose up', self.log.read_text())

    def test_failed_https_check_preserves_previous_success_marker(self):
        self.marker().write_text(self.initial + '\n', encoding='utf-8')
        self.publish_next()
        result = self.run_deploy('update', FAIL_HEALTH='60')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.marker().read_text().strip(), self.initial)

    def test_start_cannot_skip_backup_for_existing_environment(self):
        result = self.run_deploy('start', HAS_CONTAINERS='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('update', result.stderr)
        self.assertFalse(self.marker().exists())


if __name__ == '__main__':
    unittest.main()
