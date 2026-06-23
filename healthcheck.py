import http.client
import sys


def main():
    conn = None
    try:
        conn = http.client.HTTPConnection("127.0.0.1", 5000, timeout=3)
        conn.request("GET", "/healthz")
        response = conn.getresponse()
        body = response.read(256)

        if response.status == 200:
            return 0

        sys.stderr.write(f"healthcheck failed: HTTP {response.status} {response.reason}\n")
        if body:
            sys.stderr.write(body.decode("utf-8", errors="replace").strip() + "\n")
        return 1
    except Exception as exc:
        sys.stderr.write(f"healthcheck failed: {exc}\n")
        return 1
    finally:
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    sys.exit(main())
