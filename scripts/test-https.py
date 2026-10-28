#!/usr/bin/env python3
"""隔离 HTTPS/HTTP 与续期契约测试；只用 Python 标准库、Docker 和 OpenSSL。"""
import argparse
import base64
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
import textwrap
import time
import unittest
import uuid
import warnings

ROOT = Path(__file__).resolve().parents[1]
NGINX = os.environ.get("HTTPS_TEST_NGINX_IMAGE", "nginx:1.30.6-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951")
PYTHON = os.environ.get("HTTPS_TEST_PYTHON_IMAGE", "python:3.12.3-slim")


def run(*args, check=True, **kwargs):
    return subprocess.run(args, check=check, text=True, capture_output=True, **kwargs)


class RenewTests(unittest.TestCase):
    """错误服务/参数、吞掉错误或在校验前 reload 都必须失败。"""
    def test_renew_order_and_failure_propagation(self):
        with tempfile.TemporaryDirectory(prefix="devscope-renew-test-") as tmp:
            path = Path(tmp)
            fake = path / "docker"
            fake.write_text("""#!/usr/bin/env python3
import json, os, sys
with open(os.environ['CALLS'], 'a') as out: out.write(json.dumps(sys.argv[1:])+'\\n')
args = sys.argv[1:]
if 'renew' in args: sys.exit(int(os.environ.get('RENEW_EXIT', '0')))
if '-t' in args: sys.exit(int(os.environ.get('CHECK_EXIT', '0')))
if 'reload' in args: sys.exit(int(os.environ.get('RELOAD_EXIT', '0')))
""")
            fake.chmod(0o700)
            timeout = path / "timeout"
            timeout.write_text("""#!/usr/bin/env python3
import os, sys
assert sys.argv[1] == '--foreground'
assert sys.argv[2] in ['15m', '30s']
assert ('renew' in sys.argv) == (sys.argv[2] == '15m')
os.execvp(sys.argv[3], sys.argv[3:])
""")
            timeout.chmod(0o700)
            envfile = path / "tls.env"
            envfile.write_text("COMPOSE_PROJECT_NAME=must-not-be-used\n")
            callsfile = path / "calls"
            env = {**os.environ, "PATH": f"{path}:{os.environ['PATH']}", "CALLS": str(callsfile),
                   "COMPOSE_FILE": "must-not-be-used.yml", "COMPOSE_PROJECT_NAME": "wrong"}
            prefix = ["compose", "--project-name", "devscope-https", "--env-file", str(envfile),
                      "--file", str(ROOT / "docker-compose.https.yml")]
            cases = [("", {}, 0, ["renew", "-t", "reload"]),
                     ("--dry-run", {}, 0, ["renew"]),
                     ("", {"RENEW_EXIT": "17"}, 17, ["renew"]),
                     ("", {"CHECK_EXIT": "18"}, 18, ["renew", "-t"]),
                     ("", {"RELOAD_EXIT": "19"}, 19, ["renew", "-t", "reload"])]
            for mode, overrides, code, stages in cases:
                with self.subTest(mode=mode, overrides=overrides):
                    callsfile.write_text("")
                    command = ["bash", str(ROOT / "scripts/https-renew.sh"), str(envfile)]
                    result = run(*command, *([mode] if mode else []), check=False, env={**env, **overrides})
                    self.assertEqual(result.returncode, code, result.stderr)
                    calls = [json.loads(line) for line in callsfile.read_text().splitlines()]
                    expected = [prefix + ["--profile", "certbot", "run", "--rm", "--no-deps", "certbot",
                                          "renew", "--non-interactive", "--cert-name", "devscope.cn"]
                                + (["--dry-run"] if mode else [])]
                    if "-t" in stages:
                        expected.append(prefix + ["exec", "-T", "https", "nginx", "-t"])
                    if "reload" in stages:
                        expected.append(prefix + ["exec", "-T", "https", "nginx", "-s", "reload"])
                    self.assertEqual(calls, expected)
                    self.assertNotIn("PRIVATE KEY", result.stdout + result.stderr)
            missing = run("bash", str(ROOT / "scripts/https-renew.sh"), str(path / "missing"), check=False, env=env)
            self.assertNotEqual(missing.returncode, 0)


class ComposeTests(unittest.TestCase):
    def test_isolated_services_and_required_env(self):
        with tempfile.TemporaryDirectory(prefix="devscope-compose-test-") as tmp:
            envfile = Path(tmp) / "runtime.env"
            envfile.write_text("")
            command = ["docker", "compose", "--project-name", "devscope-https", "--env-file", str(envfile),
                       "--file", str(ROOT / "docker-compose.https.yml"), "config", "--format", "json"]
            env = {key: value for key, value in os.environ.items() if not key.startswith(("DEVSCOPE_TLS_", "COMPOSE_"))}
            self.assertNotEqual(run(*command, check=False, env=env).returncode, 0)
            envfile.write_text("DEVSCOPE_TLS_NGINX_IMAGE=nginx:1.30.6-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951\n"
                               "DEVSCOPE_TLS_CERTBOT_IMAGE=certbot/certbot:v5.8.0@sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20\n"
                               f"DEVSCOPE_TLS_STATE_DIR={tmp}/state\nDEVSCOPE_TLS_CONF_DIR={tmp}/conf\nDEVSCOPE_TLS_NETWORK=isolated-test-network\n")
            config = json.loads(run(*command, env=env).stdout)
            self.assertEqual(set(config["services"]), {"https"}, "Certbot must not start by default")
            command[command.index("config"):command.index("config")] = ["--profile", "certbot"]
            config = json.loads(run(*command, env=env).stdout)
            self.assertEqual(set(config["services"]), {"https", "certbot"})
            self.assertEqual(config["name"], "devscope-https")
            https = config["services"]["https"]
            self.assertEqual(https["container_name"], "devscope-https")
            self.assertEqual([(port["target"], port["published"]) for port in https["ports"]], [(443, "443")])
            self.assertEqual(config["services"]["certbot"]["profiles"], ["certbot"])
            self.assertTrue(config["networks"]["existing"]["external"])
            self.assertEqual(config["networks"]["existing"]["name"], "isolated-test-network")
            for service in config["services"].values():
                self.assertNotIn("depends_on", service)
                self.assertNotIn("env_file", service)
                for mount in service["volumes"]:
                    self.assertNotIn("docker.sock", mount["source"])
                    self.assertFalse(mount.get("bind", {}).get("create_host_path", False))
            self.assertTrue(all(mount["read_only"] for mount in https["volumes"]))


class ReloadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="devscope-reload-test-")
        self.path = Path(self.tmp.name)
        docker = self.path / "docker"
        docker.write_text("""#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['CALLS'], 'a') as out: out.write(json.dumps(args)+'\\n')
case = os.environ.get('TEST_CASE', 'running')
if args[:2] == ['container', 'ls']:
    if case == 'daemon-error': sys.exit(23)
    if case != 'absent': print('devscope-https')
elif args[0] == 'inspect':
    if case == 'inspect-error': sys.exit(24)
    print('false' if case == 'stopped' else 'true')
elif args[0] == 'exec':
    if '-t' in args and case == 'check-error': sys.exit(25)
    if 'reload' in args and case == 'reload-error': sys.exit(26)
elif args[0] != 'compose': sys.exit(99)
""")
        docker.chmod(0o700)
        timeout = self.path / "timeout"
        timeout.write_text("""#!/usr/bin/env python3
import subprocess, sys
assert sys.argv[1:3] == ['--foreground', '30s']
try: sys.exit(subprocess.run(sys.argv[3:], timeout=30).returncode)
except subprocess.TimeoutExpired: sys.exit(124)
""")
        timeout.chmod(0o700)
        self.callsfile = self.path / "calls"
        self.env = {**os.environ, "PATH": f"{self.path}:{os.environ['PATH']}", "CALLS": str(self.callsfile)}
        self.expected = [["container", "ls", "--all", "--filter", "name=^/devscope-https$", "--format", "{{.Names}}"],
                         ["inspect", "--format", "{{.State.Running}}", "devscope-https"],
                         ["exec", "devscope-https", "nginx", "-t"],
                         ["exec", "devscope-https", "nginx", "-s", "reload"]]

    def tearDown(self):
        self.tmp.cleanup()

    def calls(self):
        return [json.loads(line) for line in self.callsfile.read_text().splitlines()]

    def test_reload_branches_and_exact_target(self):
        for case, code, count in [("absent", 0, 1), ("running", 0, 4), ("stopped", 1, 2),
                                  ("daemon-error", 23, 1), ("inspect-error", 24, 2),
                                  ("check-error", 25, 3), ("reload-error", 26, 4)]:
            with self.subTest(case=case):
                self.callsfile.write_text("")
                result = run("bash", str(ROOT / "scripts/https-reload-if-present.sh"), check=False,
                             env={**self.env, "TEST_CASE": case})
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertEqual(self.calls(), self.expected[:count])

    def test_workflow_executes_reload_after_shared_proxy(self):
        workflow = (ROOT / ".github/workflows/deploy.yml").read_text()
        start = workflow.index("            # API/Web 容器重建后 upstream 地址可能变化。")
        end = workflow.index("            # 清理旧镜像", start)
        snippet = textwrap.dedent(workflow[start:end]) + "\nprintf 'completed\\n'\n"
        shared = [["compose", "-f", "docker-compose.yml", "-f", "docker-compose.prod.yml",
                   "exec", "-T", "nginx", "nginx", "-t"],
                  ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.prod.yml",
                   "exec", "-T", "nginx", "nginx", "-s", "reload"]]
        for case, code, count in [("running", 0, 4), ("absent", 0, 1), ("check-error", 25, 3),
                                  ("reload-error", 26, 4)]:
            with self.subTest(case=case):
                self.callsfile.write_text("")
                result = run("bash", "-e", "-c", snippet, cwd=ROOT, check=False,
                             env={**self.env, "TEST_CASE": case})
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertEqual(self.calls(), shared + self.expected[:count])
                self.assertEqual("completed" in result.stdout, code == 0)


MOCK = r'''
import hashlib, http.server, json, threading, time
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    retired = False
    def log_message(self, *args): pass
    def do_GET(self):
        if Handler.retired:
            self.send_response(502); self.send_header('Content-Length', '0'); self.end_headers(); return
        for path, status, body in [('/supplier-search/', 202, b'shared-supplier'), ('/billmapper/', 203, b'shared-bill')]:
            if self.path.startswith(path):
                self.send_response(status); self.send_header('Content-Length', str(len(body)))
                self.end_headers(); self.wfile.write(body); return
        if self.headers.get('Upgrade', '').lower() == 'websocket':
            self.send_response(101); self.send_header('Upgrade', 'websocket')
            self.send_header('Connection', 'Upgrade'); self.end_headers(); return
        if self.path.startswith('/api/agent/'):
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Connection', 'close'); self.end_headers()
            self.wfile.write(b'data: first\n\n'); self.wfile.flush(); time.sleep(2)
            self.wfile.write(b'data: last\n\n'); self.close_connection = True; return
        body = json.dumps({'port': self.server.server_port, 'path': self.path,
                           'proto': self.headers.get('X-Forwarded-Proto'),
                           'host': self.headers.get('Host')}).encode()
        self.send_response(200); self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        if self.path == '/_retire':
            Handler.retired = True
            self.send_response(200); self.send_header('Content-Length', '0'); self.end_headers(); return
        payload = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        body = json.dumps({'port': self.server.server_port, 'path': self.path,
                           'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}).encode()
        self.send_response(200); self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)
for port in [3100, 3000]:
    server = http.server.ThreadingHTTPServer(('0.0.0.0', port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
threading.Event().wait()
'''


class DockerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 缺少实现时明确 RED，不去修改/连接任何现有服务。
        for name in ["nginx/https/nginx.conf", "nginx/https/acme-location.conf", "nginx/https/http-domain.conf"]:
            if not (ROOT / name).is_file():
                raise AssertionError(f"HTTPS implementation missing: {name}")
        cls.tmp = tempfile.TemporaryDirectory(prefix="devscope-https-test-")
        cls.path = Path(cls.tmp.name)
        cls.name = "devscope-https-test-" + uuid.uuid4().hex[:10]
        cls.containers = []
        cls.conf = cls.path / "conf.d"
        shutil.copytree(ROOT / "nginx/conf.d", cls.conf, ignore=shutil.ignore_patterns("server-local"))
        cls.local = cls.conf / "server-local"
        cls.local.mkdir()
        cls.local.joinpath("devscope-auth.conf").write_text('auth_basic "DevScope";\nauth_basic_user_file /etc/nginx/conf.d/server-local/.devscope.htpasswd;\n')
        cls.password = uuid.uuid4().hex
        password_hash = run("openssl", "passwd", "-apr1", cls.password).stdout.strip()
        cls.local.joinpath(".devscope.htpasswd").write_text("test:" + password_hash + "\n")
        cls.token = cls.local / "acme-webroot/.well-known/acme-challenge/token-123_ABC"
        cls.token.parent.mkdir(parents=True)
        cls.token.write_text("challenge-only")
        shutil.copy(ROOT / "nginx/https/acme-location.conf", cls.local / "devscope-acme.conf")
        cls.local.joinpath("shared-routes.conf").write_text('location /supplier-search/ { proxy_pass http://api_backend; }\nlocation /billmapper/ { proxy_pass http://web_backend; }\n')
        certdir = cls.path / "certs/live/devscope.cn"
        certdir.mkdir(parents=True)
        cls.path.joinpath("extensions.cnf").write_text("subjectAltName=DNS:devscope.cn,DNS:www.devscope.cn\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\nbasicConstraints=critical,CA:FALSE\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n")
        cls.path.joinpath("ca.cnf").write_text("[req]\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n")
        run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=DevScope test CA",
            "-config", str(cls.path / "ca.cnf"), "-keyout", str(cls.path / "ca.key"), "-out", str(cls.path / "ca.crt"))
        run("openssl", "req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=devscope.cn",
            "-keyout", str(certdir / "privkey.pem"), "-out", str(cls.path / "leaf.csr"))
        run("openssl", "x509", "-req", "-in", str(cls.path / "leaf.csr"), "-CA", str(cls.path / "ca.crt"),
            "-CAkey", str(cls.path / "ca.key"), "-CAcreateserial", "-days", "2", "-extfile", str(cls.path / "extensions.cnf"),
            "-out", str(certdir / "fullchain.pem"))
        archive = cls.path / "certs/archive/devscope.cn"
        archive.mkdir(parents=True)
        for name in ["fullchain", "privkey"]:
            (certdir / f"{name}.pem").rename(archive / f"{name}1.pem")
            (certdir / f"{name}.pem").symlink_to(f"../../archive/devscope.cn/{name}1.pem")
        cls.context = ssl.create_default_context(cafile=str(cls.path / "ca.crt"))
        cls.path.joinpath("mock.py").write_text(MOCK)
        run("docker", "network", "create", cls.name)
        try:
            cls.start("upstream", ["--network-alias", "api", "--network-alias", "web",
                                  "-v", f"{cls.path}/mock.py:/mock.py:ro"], PYTHON, "python", "/mock.py")
            cls.http = cls.start("http", ["-p", "127.0.0.1::80", "-v", f"{ROOT}/nginx/nginx.conf:/etc/nginx/nginx.conf:ro",
                                          "-v", f"{cls.conf}:/etc/nginx/conf.d:ro"], NGINX)
            cls.tls = cls.start("tls", ["-p", "127.0.0.1::443", "-v", f"{ROOT}/nginx/https/nginx.conf:/etc/nginx/nginx.conf:ro",
                                        "-v", f"{cls.conf}:/etc/nginx/conf.d:ro", "-v", f"{cls.path}/certs:/etc/letsencrypt:ro"], NGINX)
            cls.http_port = cls.port(cls.http, "80/tcp")
            cls.tls_port = cls.port(cls.tls, "443/tcp")
            for _ in range(40):
                try:
                    conn, resp = cls.request("/", tls=True)
                    resp.read(); conn.close(); break
                except (OSError, http.client.HTTPException) as error:
                    last_error = error
                    time.sleep(0.1)
            else:
                raise AssertionError(f"isolated TLS did not start: {last_error}")
        except BaseException:
            for name in cls.containers:
                logs = run("docker", "logs", name, check=False)
                print(logs.stdout, logs.stderr)
                print(run("docker", "inspect", "--format", "{{json .State}}", name, check=False).stdout)
            cls.tearDownClass()
            raise

    @classmethod
    def start(cls, suffix, options, image, *command):
        name = cls.name + "-" + suffix
        run("docker", "run", "-d", "--name", name, "--network", cls.name, *options, image, *command)
        cls.containers.append(name)
        return name

    @classmethod
    def port(cls, name, port):
        return int(run("docker", "port", name, port).stdout.strip().rsplit(":", 1)[1])

    @classmethod
    def request(cls, path, tls=False, auth=None, host="devscope.cn", headers=None, method="GET", body=None):
        conn = http.client.HTTPConnection("127.0.0.1", cls.tls_port if tls else cls.http_port, timeout=5)
        if tls:
            conn.sock = cls.context.wrap_socket(socket.create_connection(("127.0.0.1", cls.tls_port), timeout=5), server_hostname=host)
        request_headers = {"Host": host, **(headers or {})}
        if auth:
            request_headers["Authorization"] = "Basic " + base64.b64encode(("test:" + auth).encode()).decode()
        conn.request(method, path, body=body, headers=request_headers)
        return conn, conn.getresponse()

    def assert_status(self, path, status, **kwargs):
        conn, response = self.request(path, **kwargs)
        body = response.read()
        self.assertEqual(response.status, status, f"{path}: {body[:100]!r}")
        headers = dict(response.getheaders())
        conn.close()
        return body, headers

    def test_01_auth_routes_and_forwarded_proto(self):
        for path in ["/", "/_next/static/test.js", "/api/health", "/trpc/health", "/api/agent/stream"]:
            for tls in [False, True]:
                self.assert_status(path, 401, tls=tls)
                self.assert_status(path, 401, tls=tls, auth="wrong")
        for host in ["devscope.cn", "www.devscope.cn"]:
            for path, port in [("/", 3000), ("/_next/static/test.js", 3000), ("/api/health", 3100), ("/trpc/health", 3100)]:
                body, _ = self.assert_status(path, 200, tls=True, host=host, auth=self.password,
                                             headers={"X-Forwarded-Proto": "http"})
                self.assertEqual(json.loads(body), {"port": port, "path": path, "proto": "https", "host": host})
        body, _ = self.assert_status("/trpc/health", 200, auth=self.password)
        self.assertEqual(json.loads(body)["proto"], "http")

    def test_02_stream_and_websocket(self):
        for tls in [False, True]:
            start = time.monotonic()
            conn, response = self.request("/api/agent/stream", tls=tls, auth=self.password)
            self.assertEqual(response.status, 200)
            self.assertEqual(response.readline(), b"data: first\n")
            self.assertLess(time.monotonic() - start, 1.5, "SSE was buffered")
            self.assertIn(b"data: last", response.read()); conn.close()
            self.assert_status("/ws", 101, tls=tls, auth=self.password,
                               headers={"Upgrade": "websocket", "Connection": "Upgrade"})

    def test_03_acme_and_staged_redirect(self):
        payload = b"shared-body-test" * (2 * 1024 * 1024 // 16)
        expected_sha = hashlib.sha256(payload).hexdigest()

        def assert_shared_post_limits():
            for host in ["devscope.cn", "www.devscope.cn"]:
                for path, port in [("/supplier-search/upload", 3100), ("/billmapper/upload", 3000)]:
                    body, _ = self.assert_status(path, 200, host=host, method="POST", body=payload)
                    self.assertEqual(json.loads(body), {"port": port, "path": path,
                                                       "bytes": 2097152, "sha256": expected_sha})
                    # Nginx 按 Content-Length 在读 body 前拒绝；Expect 避免发送已被拒绝的 10MiB+ body。
                    self.assert_status(path, 413, host=host, method="POST", body=b"",
                                       headers={"Content-Length": "10485761", "Expect": "100-continue"})

        assert_shared_post_limits()
        path = "/.well-known/acme-challenge/token-123_ABC"
        for host in ["devscope.cn", "www.devscope.cn"]:
            self.assertEqual(self.assert_status(path, 200, host=host)[0], b"challenge-only")
            self.assertEqual(self.assert_status("/supplier-search/", 202, host=host)[0], b"shared-supplier")
            self.assertEqual(self.assert_status("/billmapper/", 203, host=host)[0], b"shared-bill")
        self.assert_status(path + "?probe=1", 200)
        for bad in ["/.well-known/acme-challenge/%74oken-123_ABC", "/.well-known/acme-challenge/a.b"]:
            self.assert_status(bad, 404)
        secret_link = self.token.with_name("linked-secret")
        secret_link.symlink_to("../../../devscope-auth.conf")
        try:
            self.assert_status("/.well-known/acme-challenge/linked-secret", 404)
        finally:
            secret_link.unlink()
        self.assert_status(path, 401, tls=True)
        for bad in ["/.well-known/acme-challenge/", "/.well-known/acme-challenge/missing", "/.well-known/acme-challenge/a/b"]:
            self.assert_status(bad, 404)
        for bad in ["/.well-known/other", "/.well-known/acme-challenge/../.devscope.htpasswd",
                    "/.well-known/acme-challenge/%2e%2e/devscope-auth.conf"]:
            self.assert_status(bad, 401)
        self.assert_status("/supplier-search/", 202)
        self.assert_status("/billmapper/", 203)
        shutil.copy(ROOT / "nginx/https/http-domain.conf", self.local / "devscope-http-domain.conf")
        run("docker", "exec", self.http, "nginx", "-t")
        run("docker", "exec", self.http, "nginx", "-s", "reload")
        time.sleep(0.3)
        try:
            assert_shared_post_limits()
            for host in ["devscope.cn", "www.devscope.cn"]:
                _, headers = self.assert_status("/api/health?x=1", 308, host=host)
                self.assertEqual(headers["Location"], f"https://{host}/api/health?x=1")
                self.assert_status(path, 200, host=host)
                self.assert_status("/.well-known/acme-challenge/missing", 404, host=host)
                self.assertEqual(self.assert_status("/supplier-search/", 202, host=host)[0], b"shared-supplier")
                self.assertEqual(self.assert_status("/billmapper/", 203, host=host)[0], b"shared-bill")
            for host in ["127.0.0.1", "192.0.2.1", "other.example"]:
                self.assert_status("/", 401, host=host)
                self.assert_status("/supplier-search/", 202, host=host)
                self.assert_status("/billmapper/", 203, host=host)
        finally:
            self.local.joinpath("devscope-http-domain.conf").unlink()
            run("docker", "exec", self.http, "nginx", "-t")
            run("docker", "exec", self.http, "nginx", "-s", "reload")

    def test_04_missing_auth_and_certificate_fail_closed(self):
        auth = self.local / "devscope-auth.conf"
        saved = auth.read_bytes(); auth.unlink()
        try:
            result = run("docker", "exec", self.tls, "nginx", "-t", check=False)
            self.assertNotEqual(result.returncode, 0)
        finally:
            auth.write_bytes(saved)
        htpasswd = self.local / ".devscope.htpasswd"
        saved = htpasswd.read_bytes(); htpasswd.unlink()
        try:
            for path in ["/", "/api/health", "/trpc/health", "/api/agent/stream"]:
                self.assert_status(path, 401, tls=True)
                self.assert_status(path, 403, tls=True, auth=self.password)
        finally:
            htpasswd.write_bytes(saved)
        # 全新空 bind 源验证冷启动；不依赖 Docker Desktop 对 symlink rename 的可见性延迟。
        empty_certs = self.path / "empty-certs"
        empty_certs.mkdir()
        result = run("docker", "run", "--rm", "--name", self.name + "-missing-cert", "--network", self.name,
                     "-v", f"{ROOT}/nginx/https/nginx.conf:/etc/nginx/nginx.conf:ro",
                     "-v", f"{self.conf}:/etc/nginx/conf.d:ro", "-v", f"{empty_certs}:/etc/letsencrypt:ro",
                     NGINX, "nginx", "-t", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("cannot load certificate", result.stderr)

    def test_05_certificate_symlink_rotation_and_real_reload(self):
        def served_cert():
            with socket.create_connection(("127.0.0.1", self.tls_port), timeout=5) as sock:
                with self.context.wrap_socket(sock, server_hostname="devscope.cn") as tls:
                    return tls.getpeercert(binary_form=True)
        before = served_cert()
        archive = self.path / "certs/archive/devscope.cn"
        run("openssl", "x509", "-req", "-in", str(self.path / "leaf.csr"), "-CA", str(self.path / "ca.crt"),
            "-CAkey", str(self.path / "ca.key"), "-set_serial", "999", "-days", "2", "-extfile", str(self.path / "extensions.cnf"),
            "-out", str(archive / "fullchain2.pem"))
        live = self.path / "certs/live/devscope.cn/fullchain.pem"
        replacement = live.with_name("fullchain.new")
        replacement.symlink_to("../../archive/devscope.cn/fullchain2.pem")
        replacement.replace(live)
        self.assertEqual(served_cert(), before, "disk change alone must not claim loaded renewal")
        run("docker", "exec", self.tls, "nginx", "-t")
        run("docker", "exec", self.tls, "nginx", "-s", "reload")
        for _ in range(30):
            after = served_cert()
            if after != before:
                break
            time.sleep(0.1)
        self.assertNotEqual(after, before)
        expected = ssl.PEM_cert_to_DER_cert((archive / "fullchain2.pem").read_text())
        self.assertEqual(after, expected)
        with socket.create_connection(("127.0.0.1", self.tls_port), timeout=5) as sock:
            with self.assertRaises(ssl.SSLError):
                self.context.wrap_socket(sock, server_hostname="other.example")

    def test_06_tls_versions(self):
        for version, label in [(ssl.TLSVersion.TLSv1_2, "TLSv1.2"), (ssl.TLSVersion.TLSv1_3, "TLSv1.3")]:
            context = ssl.create_default_context(cafile=str(self.path / "ca.crt"))
            context.minimum_version = context.maximum_version = version
            with socket.create_connection(("127.0.0.1", self.tls_port), timeout=5) as sock:
                with context.wrap_socket(sock, server_hostname="devscope.cn") as tls:
                    self.assertEqual(tls.version(), label)
        # 测试客户端故意支持旧协议；生产连接从不降低 TLS/证书校验。
        for version in [ssl.TLSVersion.TLSv1, ssl.TLSVersion.TLSv1_1]:
            context = ssl.create_default_context(cafile=str(self.path / "ca.crt"))
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                context.minimum_version = context.maximum_version = version
            context.set_ciphers("ALL:@SECLEVEL=0")
            with socket.create_connection(("127.0.0.1", self.tls_port), timeout=5) as sock:
                with self.assertRaises(ssl.SSLError):
                    context.wrap_socket(sock, server_hostname="devscope.cn")

    def test_07_deploy_reload_refreshes_changed_upstream_ip_without_recreate(self):
        old = self.name + "-upstream"
        old_ip = run("docker", "inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", old).stdout.strip()
        edge_id = run("docker", "inspect", "--format", "{{.Id}}", self.tls).stdout.strip()
        new = self.start("upstream-next", ["--network-alias", "api", "--network-alias", "web",
                                          "-v", f"{self.path}/mock.py:/mock.py:ro"], PYTHON, "python", "/mock.py")
        new_ip = run("docker", "inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", new).stdout.strip()
        self.assertNotEqual(new_ip, old_ip)
        # 保留旧 A 的地址但移除业务 aliases；旧进程明确报错，新 API/Web 只由 B 提供。
        run("docker", "network", "disconnect", self.name, old)
        run("docker", "network", "connect", "--ip", old_ip, "--alias", "stale-upstream", self.name, old)
        resolved = json.loads(run("docker", "exec", new, "python", "-c",
                                 "import json,socket; print(json.dumps({name:sorted({a[4][0] for a in socket.getaddrinfo(name,None,socket.AF_INET)}) for name in ['api','web']}))").stdout)
        self.assertEqual(resolved, {"api": [new_ip], "web": [new_ip]})
        run("docker", "exec", old, "python", "-c",
            "import urllib.request; urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:3100/_retire', method='POST')).read()")
        self.assert_status("/trpc/health", 502, tls=True, auth=self.password)
        self.assert_status("/", 502, tls=True, auth=self.password)
        # 生产 helper 不接受可变目标；仅测试 CLI 边界映射到本轮随机名称，实调用 Docker。
        shim_dir = self.path / "reload-bin"
        shim_dir.mkdir()
        shim = shim_dir / "docker"
        shim.write_text("""#!/usr/bin/env python3
import os, subprocess, sys
args = [os.environ['TEST_TLS'] if arg == 'devscope-https' else
        'name=^/' + os.environ['TEST_TLS'] + '$' if arg == 'name=^/devscope-https$' else arg
        for arg in sys.argv[1:]]
result = subprocess.run([os.environ['REAL_DOCKER'], *args], capture_output=True)
sys.stdout.buffer.write(result.stdout.replace(os.environ['TEST_TLS'].encode(), b'devscope-https'))
sys.stderr.buffer.write(result.stderr)
sys.exit(result.returncode)
""")
        shim.chmod(0o700)
        timeout = shim_dir / "timeout"
        timeout.write_text("""#!/usr/bin/env python3
import subprocess, sys
assert sys.argv[1:3] == ['--foreground', '30s']
try: sys.exit(subprocess.run(sys.argv[3:], timeout=30).returncode)
except subprocess.TimeoutExpired: sys.exit(124)
""")
        timeout.chmod(0o700)
        run("bash", str(ROOT / "scripts/https-reload-if-present.sh"),
            env={**os.environ, "PATH": f"{shim_dir}:{os.environ['PATH']}",
                 "TEST_TLS": self.tls, "REAL_DOCKER": shutil.which("docker")})
        time.sleep(0.3)
        for path, port in [("/trpc/health", 3100), ("/", 3000)]:
            body, _ = self.assert_status(path, 200, tls=True, auth=self.password)
            self.assertEqual(json.loads(body)["port"], port)
        self.assertEqual(run("docker", "inspect", "--format", "{{.Id}}", self.tls).stdout.strip(), edge_id)

    @classmethod
    def tearDownClass(cls):
        for name in reversed(cls.containers):
            run("docker", "rm", "-f", name, check=False)
        run("docker", "network", "rm", cls.name, check=False)
        cls.tmp.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--renew-only", action="store_true")
    args = parser.parse_args()
    suite = unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(RenewTests),
                               unittest.defaultTestLoader.loadTestsFromTestCase(ComposeTests),
                               unittest.defaultTestLoader.loadTestsFromTestCase(ReloadTests)])
    if not args.renew_only:
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(DockerTests))
    raise SystemExit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
