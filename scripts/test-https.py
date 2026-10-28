#!/usr/bin/env python3
"""隔离 HTTPS/HTTP 与续期契约测试；只用 Python 标准库、Docker 和 OpenSSL。"""
import argparse
import base64
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile
import time
import unittest
import uuid
import warnings

ROOT = Path(__file__).resolve().parents[1]
NGINX = os.environ.get("HTTPS_TEST_NGINX_IMAGE", "nginx:1.30.0-alpine")
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
            envfile.write_text("DEVSCOPE_TLS_NGINX_IMAGE=nginx@sha256:8aa63af009a39ecd6c28d61da578a5447378c10bb097a069e3a3e0fb42bb6b19\n"
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


MOCK = r'''
import http.server, json, threading, time
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args): pass
    def do_GET(self):
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
        cls.local.joinpath("shared-routes.conf").write_text('location /supplier-search/ { return 202 "shared-supplier"; }\nlocation /billmapper/ { return 203 "shared-bill"; }\n')
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
    def request(cls, path, tls=False, auth=None, host="devscope.cn", headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", cls.tls_port if tls else cls.http_port, timeout=5)
        if tls:
            conn.sock = cls.context.wrap_socket(socket.create_connection(("127.0.0.1", cls.tls_port), timeout=5), server_hostname=host)
        request_headers = {"Host": host, **(headers or {})}
        if auth:
            request_headers["Authorization"] = "Basic " + base64.b64encode(("test:" + auth).encode()).decode()
        conn.request("GET", path, headers=request_headers)
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
                               unittest.defaultTestLoader.loadTestsFromTestCase(ComposeTests)])
    if not args.renew_only:
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(DockerTests))
    raise SystemExit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
