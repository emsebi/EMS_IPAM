"""Offline protocol checks for the two-source real Docker smoke probe."""
import hashlib
import hmac
import importlib.util
from pathlib import Path
import socket
import struct
import threading
import unittest
from unittest.mock import patch

path = Path(__file__).parents[1] / 'freeradius/udp_probe.py'
spec = importlib.util.spec_from_file_location('radius_udp_probe', path)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class RadiusProbeTest(unittest.TestCase):
    def test_pap_request_password_is_hidden_and_message_authenticator_valid(self):
        secret = b'ephemeral-lab-secret-123'
        req_auth = bytes(range(16))
        packet, request_auth = probe.request_packet(
            'testadminA', 'example-password', secret, '127.0.0.2', 19, req_auth)
        self.assertEqual(request_auth, req_auth)
        self.assertEqual(packet[:4], struct.pack('!BBH', 1, 19, len(packet)))
        self.assertNotIn(b'example-password', packet)
        self.assertEqual(packet[20], 1)
        self.assertIn(socket.inet_aton('127.0.0.2'), packet)
        self.assertEqual(packet[-18:-16], b'\x50\x12')
        expected = hmac.new(secret, packet[:-16] + b'\x00' * 16, hashlib.md5).digest()
        self.assertEqual(packet[-16:], expected)

    def test_pap_password_multiple_blocks_follow_rfc2865(self):
        secret = b'test-secret'
        auth = b'0123456789abcdef'
        password = 'x' * 33
        encrypted = probe.hide_password(password, secret, auth)
        self.assertEqual(len(encrypted), 48)
        previous = auth
        clear = bytearray()
        for i in range(0, len(encrypted), 16):
            block = encrypted[i:i+16]
            digest = hashlib.md5(secret + previous).digest()
            clear.extend(a ^ b for a, b in zip(block, digest))
            previous = block
        self.assertEqual(bytes(clear).rstrip(b'\0'), password.encode())

    def test_response_authenticator_and_request_id_are_checked(self):
        secret = b'test-secret'
        request_auth = b'0123456789abcdef'
        header = struct.pack('!BBH', 2, 77, 20)
        digest = hashlib.md5(header + request_auth + secret).digest()
        packet = header + digest
        self.assertEqual(probe.verify_response(packet, request_auth, secret, 77), 'Access-Accept')
        reject_header = struct.pack('!BBH', 3, 77, 20)
        reject = reject_header + hashlib.md5(reject_header + request_auth + secret).digest()
        self.assertEqual(probe.verify_response(reject, request_auth, secret, 77), 'Access-Reject')
        with self.assertRaises(ValueError):
            probe.verify_response(packet, request_auth, b'wrong-secret', 77)
        with self.assertRaises(ValueError):
            probe.verify_response(packet, request_auth, secret, 78)

    def test_response_message_authenticator_is_verified(self):
        secret = b'ephemeral-lab-secret-123'
        request_auth = bytes(range(16))
        header = struct.pack('!BBH', 2, 77, 38)
        unsigned = header + request_auth + probe.attr(80, b'\x00' * 16)
        mac = hmac.new(secret, unsigned, hashlib.md5).digest()
        attributes = probe.attr(80, mac)
        response_auth = hashlib.md5(header + request_auth + attributes + secret).digest()
        response = header + response_auth + attributes
        self.assertEqual(probe.verify_response(response, request_auth, secret, 77), 'Access-Accept')
        # Recompute the outer MD5 with a maliciously modified inner HMAC.
        # A verifier checking only RFC 2865 MD5 would accept this packet.
        forged_attributes = probe.attr(80, b'X' * 16)
        forged_auth = hashlib.md5(header + request_auth + forged_attributes + secret).digest()
        with self.assertRaisesRegex(ValueError, 'Message-Authenticator'):
            probe.verify_response(header + forged_auth + forged_attributes, request_auth, secret, 77)

    def test_rejects_duplicate_and_malformed_radius_attributes(self):
        secret = b'ephemeral-lab-secret-123'
        req_auth = bytes(range(16))
        for attributes in (b'\x01\x00', b'\x01\x05a',
                           probe.attr(80, b'X' * 16) * 2,
                           probe.attr(80, b'X' * 15)):
            header = struct.pack('!BBH', 3, 18, 20 + len(attributes))
            digest = hashlib.md5(header + req_auth + attributes + secret).digest()
            with self.assertRaises(ValueError):
                probe.verify_response(header + digest + attributes, req_auth, secret, 18)

    def test_actual_loopback_udp_source_differs_from_spoofed_nas_attribute(self):
        """Real UDP socket exchange with a disposable fake RADIUS server.

        This verifies the two-source smoke-test harness, NOT FreeRADIUS itself.
        """
        secret = b'ephemeral-lab-secret-123'
        seen = {}
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as server:
            server.bind(('127.0.0.1', 0))
            server.settimeout(4)
            port = server.getsockname()[1]

            def answer():
                packet, addr = server.recvfrom(4096)
                seen['source'] = addr[0]
                seen['claimed'] = packet[20:].find(probe.attr(4, socket.inet_aton('127.0.0.1'))) >= 0
                header = struct.pack('!BBH', 2, packet[1], 20)
                response = header + hashlib.md5(header + packet[4:20] + secret).digest()
                server.sendto(response, addr)

            worker = threading.Thread(target=answer, daemon=True)
            worker.start()
            self.assertEqual(probe.probe('127.10.20.2', '127.0.0.1',
                                          'testadminA', 'example-password',
                                          secret.decode(), destination_port=port), 'Access-Accept')
            worker.join(timeout=4)
            self.assertEqual(seen, {'source': '127.10.20.2', 'claimed': True})

    def test_probe_cannot_send_to_real_network_or_unapproved_sources(self):
        with patch.object(probe.socket, 'socket') as mocked:
            with self.assertRaises(ValueError):
                probe.probe('10.0.0.1', '127.0.0.1', 'user', 'pass', 'secret')
            with self.assertRaises(ValueError):
                probe.probe('127.0.0.1', '10.0.0.1', 'user', 'pass', 'secret')
            with self.assertRaises(ValueError):
                probe.probe('::1', '127.0.0.1', 'user', 'pass', 'secret')
            mocked.assert_not_called()


if __name__ == '__main__':
    unittest.main()
