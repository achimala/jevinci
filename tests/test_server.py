import importlib.util
import io
import json
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('studio_server', Path(__file__).parents[1] / 'server.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ProxyTests(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), module.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.connection = HTTPConnection('127.0.0.1', self.server.server_port)

    def tearDown(self):
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_forwarding(self):
        payload = b'{"state":"test","model":"jev-latest","questions":{}}'
        with patch.object(module, 'urlopen', return_value=io.BytesIO(b'{"answers":{}}')) as upstream:
            self.connection.request('POST', '/api/jev', payload, {'Authorization':'Bearer test-only'})
            response = self.connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read()), {'answers':{}})
            request = upstream.call_args.args[0]
            self.assertEqual(request.full_url, module.ENDPOINT)
            self.assertEqual(request.data, payload)
            self.assertEqual(request.get_header('Authorization'), 'Bearer test-only')

    def test_cross_origin_rejected(self):
        with patch.object(module, 'urlopen') as upstream:
            self.connection.request('POST','/api/jev','{}',{'Origin':'https://untrusted.example','Authorization':'Bearer test-only'})
            self.assertEqual(self.connection.getresponse().status,403)
            upstream.assert_not_called()

    def test_key_required(self):
        self.connection.request('POST','/api/jev','{}')
        self.assertEqual(self.connection.getresponse().status,401)

if __name__ == '__main__':
    unittest.main()
