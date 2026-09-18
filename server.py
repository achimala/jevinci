#!/usr/bin/env python3
"""Static local studio + fixed-destination Jev proxy. Standard library only."""
import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

WEB = Path(__file__).resolve().parent / 'web'
ENDPOINT = 'https://api.typesafe.ai/v1/systemone'

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def log_message(self, *_):
        pass  # Never log request headers, prompts, or credentials.

    def local(self):
        port = self.server.server_port
        origins = {f'http://127.0.0.1:{port}', f'http://localhost:{port}'}
        return self.headers.get('Host') in {f'127.0.0.1:{port}', f'localhost:{port}'} and self.headers.get('Origin', f'http://127.0.0.1:{port}') in origins

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()

    def do_GET(self):
        if not self.local():
            return self.send_error(403)
        super().do_GET()

    def do_POST(self):
        if not self.local():
            return self.send_error(403)
        if self.path != '/api/jev':
            return self.send_error(404)
        auth = self.headers.get('Authorization', '')
        if not auth.startswith('Bearer ') or not auth[7:].strip():
            return self.send_error(401)
        try:
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= 2_000_000:
                return self.send_error(413)
            body = self.rfile.read(length)
            json.loads(body)
        except (ValueError, UnicodeError):
            return self.send_error(400)
        request = Request(ENDPOINT, data=body, headers={'Authorization':auth, 'Content-Type':'application/json'}, method='POST')
        try:
            with urlopen(request, timeout=150) as response:
                payload = response.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except HTTPError as error:
            # Do not relay arbitrary upstream messages or reflect secrets.
            self.send_error(error.code)
        except (URLError, TimeoutError, OSError):
            self.send_error(502)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8791)
    args = parser.parse_args()
    with ThreadingHTTPServer(('127.0.0.1', args.port), Handler) as server:
        print(f'Jev studio → http://127.0.0.1:{args.port}\nPaste your API key in Settings. Ctrl+C to stop.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
